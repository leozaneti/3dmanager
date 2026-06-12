import { read, utils } from "xlsx";

const HEADER_CANDIDATES = ["N.º de venda", "Pedido de compra", "Data da venda"];

export type ParsedRow = Record<string, string | number | undefined>;
export type ParsedOrder = {
  saleNumber: string;
  orderNumber: string;
  buyerName: string;
  document: string;
  address: string;
  city: string;
  state: string;
  cep: string;
  country: string;
  saleDate: string;
  status: string;
  statusDescription: string;
  channelPayment: string;
  items: {
    sku: string;
    title: string;
    variation: string;
    quantity: number;
    unitPrice: number;
  }[];
  financials: {
    productsRevenue: number;
    shippingRevenue: number;
    platformFee: number;
    shippingFee: number;
    discount: number;
    total: number;
  };
  delivery: {
    method: string;
    trackingCode: string;
    trackingUrl: string;
    sentDate: string;
    deliveredDate: string;
  };
  raw: ParsedRow;
};

export function parseMercadoLivreXlsx(data: Buffer): ParsedOrder[] {
  const workbook = read(data, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("Arquivo não contém planilhas");
  }
  const sheet = workbook.Sheets[sheetName];
  const rows: string[][] = utils.sheet_to_json(sheet, { header: 1, defval: "" }) as string[][];

  const headerRowIndex = rows.findIndex((row) =>
    HEADER_CANDIDATES.some((h) => row.some((cell) => String(cell).trim() === h))
  );
  if (headerRowIndex < 0) {
    throw new Error("Cabeçalho não encontrado. Esperado: 'N.º de venda' ou 'Pedido de compra'");
  }

  const headers = rows[headerRowIndex].map((h) => String(h).trim());
  const dataRows = rows.slice(headerRowIndex + 1);

  const orders = new Map<string, ParsedOrder>();
  const infoRows: { rowNumber: number; error: string }[] = [];

  type BundleCtx = {
    saleNumber: string;
    orderNumber: string;
    buyerName: string;
    document: string;
    address: string;
    city: string;
    state: string;
    cep: string;
    country: string;
    saleDate: string;
    status: string;
    statusDescription: string;
    channelPayment: string;
    financials: ParsedOrder["financials"];
    delivery: ParsedOrder["delivery"];
    items: ParsedOrder["items"];
    raw: ParsedRow;
  };

  let pendingBundle: BundleCtx | null = null;

  function parseStatusFromText(text: string): string {
    const lower = text.toLowerCase();
    if (lower.includes("devolvido") || lower.includes("devolucao")) return "Devolvido";
    if (lower.includes("cancelado") || lower.includes("cancelada")) return "Cancelado";
    if (lower.includes("entregue")) return "Entregue";
    if (lower.includes("enviado") || lower.includes("a caminho")) return "Enviado";
    if (lower.includes("produção") || lower.includes("producao") || lower.includes("preparando")) return "Novo";
    return "";
  }

  function isRealStatus(s: string): boolean {
    if (!s || s.length < 3) return false;
    return parseStatusFromText(s) !== "";
  }

  const STATUS_LEVEL: Record<string, number> = {
    "novo": 1,
    "enviado": 2,
    "entregue": 3,
    "devolvido": 4,
    "cancelado": 4,
  };

  function getStatusLevel(status: string, description: string): number {
    const combined = `${status} ${description}`.toLowerCase();
    const parsed = parseStatusFromText(combined);
    if (parsed) return STATUS_LEVEL[parsed.toLowerCase()] ?? 0;
    return 0;
  }

  const finalizeBundle = (ctx: BundleCtx): ParsedOrder => {
    let finalStatus = ctx.status;
    let finalDesc = ctx.statusDescription;
    // If bundle status is still the placeholder, try to derive real status
    if (finalStatus.toLowerCase().includes("pacote") || !isRealStatus(finalStatus)) {
      const extracted = parseStatusFromText(`${finalStatus} ${finalDesc}`);
      if (extracted) {
        finalStatus = extracted;
      }
    }
    return {
      saleNumber: ctx.saleNumber,
      orderNumber: ctx.orderNumber,
      buyerName: ctx.buyerName,
      document: ctx.document,
      address: ctx.address,
      city: ctx.city,
      state: ctx.state,
      cep: ctx.cep,
      country: ctx.country,
      saleDate: ctx.saleDate,
      status: finalStatus,
      statusDescription: finalDesc,
      channelPayment: ctx.channelPayment,
      items: ctx.items,
      financials: ctx.financials,
      delivery: ctx.delivery,
      raw: ctx.raw,
    };
  };

  dataRows.forEach((row, idx) => {
    const rowNumber = headerRowIndex + 2 + idx;
    if (row.every((cell) => !cell || String(cell).trim() === "")) return;

    const rowObj: ParsedRow = {};
    headers.forEach((header, i) => {
      const value = String(row[i] ?? "").trim();
      if (header in rowObj) return;
      rowObj[header] = value;
    });

    const saleNumber = getString(rowObj, "N.º de venda");
    const orderNumber = getString(rowObj, "Pedido de compra");
    const saleDateValue = getStringBySubstring(rowObj, ["data da venda"]);

    if (!saleNumber && !orderNumber) {
      infoRows.push({ rowNumber, error: "Pedido sem número identificador" });
      return;
    }

    const key = saleNumber || orderNumber || "";
    if (!key) return;

    // --- Bundle detection ---
    const buyerName = getString(rowObj, "Comprador");
    const sku = getString(rowObj, "SKU");
    // Status: read "Status" column if it exists, fallback to first "Estado" column
    const statusIdx = headers.findIndex((h) => {
      const lower = h.toLowerCase();
      return lower === "status" || (lower.includes("status") && !lower.includes("descri"));
    });
    const statusFromCol = statusIdx >= 0 ? String(row[statusIdx] ?? "").trim() : "";

    // Bundle detection: use first "Estado" column by INDEX (there are TWO "Estado" cols in ML report!)
    const firstEstadoIdx = headers.findIndex((h) => h.toLowerCase() === "estado");
    const estadoVal = firstEstadoIdx >= 0 ? String(row[firstEstadoIdx] ?? "").trim() : "";
    const status = statusFromCol || estadoVal;
    const pacoteDiversos = getStringBySubstring(rowObj, ["pacote de diversos", "pacote"]);

    const isBundleSummary = estadoVal.toLowerCase().includes("pacote") && !!buyerName && !sku;
    const isBundleItem = pacoteDiversos === "Sim" && !!sku;

    if (isBundleSummary) {
      if (pendingBundle) {
        const b = pendingBundle;
        orders.set(b.saleNumber || b.orderNumber, finalizeBundle(b));
      }
      pendingBundle = {
        saleNumber: saleNumber || "",
        orderNumber: orderNumber || "",
        buyerName,
        document: cleanDocument(getString(rowObj, "CPF")),
        address: getString(rowObj, "Endereço"),
        city: getString(rowObj, "Cidade"),
        state: getString(rowObj, "Estado").toUpperCase(),
        cep: cleanCEP(getString(rowObj, "CEP")),
        country: getString(rowObj, "País"),
        saleDate: parseExcelDate(saleDateValue),
        status,
        statusDescription: getString(rowObj, "Descrição do status"),
        channelPayment: getStringBySubstring(rowObj, ["data da venda"]),
        financials: {
          productsRevenue: parseBRL(getString(rowObj, "Receita por produtos (BRL)")),
          shippingRevenue: parseBRL(getString(rowObj, "Receita por envio (BRL)")),
          platformFee: parseBRL(getString(rowObj, "Tarifa de venda e impostos (BRL)")),
          shippingFee: parseBRL(getString(rowObj, "Tarifas de envio (BRL)")),
          discount: parseBRL(getStringBySubstring(rowObj, ["descontos", "bônus"])),
          total: parseBRL(getString(rowObj, "Total (BRL)")),
        },
        delivery: {
          method: getString(rowObj, "Forma de entrega"),
          trackingCode: getString(rowObj, "Número de rastreamento"),
          trackingUrl: getString(rowObj, "URL de acompanhamento"),
          sentDate: parseExcelDate(getString(rowObj, "Data a caminho")),
          deliveredDate: parseExcelDate(getString(rowObj, "Data de entrega")),
        },
        items: [],
        raw: rowObj,
      };
      return;
    }

    if (isBundleItem) {
      if (pendingBundle) {
        // Item rows have the real status. For multi-package bundles, use the
        // LESS advanced status across all items (conservative).
        const itemStatus = status;
        const itemStatusDesc = getString(rowObj, "Descrição do status");
        const newLevel = getStatusLevel(itemStatus, itemStatusDesc);
        const currentLevel = getStatusLevel(pendingBundle.status, pendingBundle.statusDescription);
        if (newLevel > 0 && (currentLevel === 0 || newLevel < currentLevel)) {
          pendingBundle.status = itemStatus;
          pendingBundle.statusDescription = itemStatusDesc;
        }
        pendingBundle.items.push({
          sku: getString(rowObj, "SKU"),
          title: getString(rowObj, "Título do anúncio"),
          variation: getString(rowObj, "Variação"),
          quantity: getInt(rowObj, "Unidades"),
          unitPrice: parseBRL(getStringBySubstring(rowObj, ["unitário", "preço"])),
        });
        return;
      }
      // Fall through: pacote=Sim mas sem bundle ativo → tratar como pedido avulso
    }

    // Finalize pending bundle before processing a standalone order
    if (pendingBundle) {
      const b = pendingBundle;
      orders.set(b.saleNumber || b.orderNumber, finalizeBundle(b));
      pendingBundle = null;
    }

    // --- Standalone order ---
    const existing = orders.get(key);
    if (existing) {
      // If existing order has bundle placeholder status, update to real status
      if (status && existing.status.toLowerCase().includes("pacote")) {
        existing.status = status;
        existing.statusDescription = getString(rowObj, "Descrição do status") || existing.statusDescription;
      }
      existing.items.push({
        sku: getString(rowObj, "SKU"),
        title: getString(rowObj, "Título do anúncio"),
        variation: getString(rowObj, "Variação"),
        quantity: getInt(rowObj, "Unidades"),
        unitPrice: parseBRL(getStringBySubstring(rowObj, ["unitário", "preço"])),
      });
      return;
    }

    const parsed: ParsedOrder = {
      saleNumber: saleNumber || "",
      orderNumber: orderNumber || "",
      buyerName,
      document: cleanDocument(getString(rowObj, "CPF")),
      address: getString(rowObj, "Endereço"),
      city: getString(rowObj, "Cidade"),
      state: getString(rowObj, "Estado").toUpperCase(),
      cep: cleanCEP(getString(rowObj, "CEP")),
      country: getString(rowObj, "País"),
      saleDate: parseExcelDate(saleDateValue),
      status,
      statusDescription: getString(rowObj, "Descrição do status"),
      channelPayment: getStringBySubstring(rowObj, ["data da venda"]),
      items: [
        {
          sku: getString(rowObj, "SKU"),
          title: getString(rowObj, "Título do anúncio"),
          variation: getString(rowObj, "Variação"),
          quantity: getInt(rowObj, "Unidades"),
          unitPrice: parseBRL(getStringBySubstring(rowObj, ["unitário", "preço"])),
        },
      ],
      financials: {
        productsRevenue: parseBRL(getString(rowObj, "Receita por produtos (BRL)")),
        shippingRevenue: parseBRL(getString(rowObj, "Receita por envio (BRL)")),
        platformFee: parseBRL(getString(rowObj, "Tarifa de venda e impostos (BRL)")),
        shippingFee: parseBRL(getString(rowObj, "Tarifas de envio (BRL)")),
        discount: parseBRL(getStringBySubstring(rowObj, ["descontos", "bônus"])),
        total: parseBRL(getString(rowObj, "Total (BRL)")),
      },
      delivery: {
        method: getString(rowObj, "Forma de entrega"),
        trackingCode: getString(rowObj, "Número de rastreamento"),
        trackingUrl: getString(rowObj, "URL de acompanhamento"),
        sentDate: parseExcelDate(getString(rowObj, "Data a caminho")),
        deliveredDate: parseExcelDate(getString(rowObj, "Data de entrega")),
      },
      raw: rowObj,
    };

    if (!parsed.buyerName) {
      infoRows.push({ rowNumber, error: "Cliente sem nome" });
    }

    orders.set(key, parsed);
  });

  if (pendingBundle) {
    const ctx: BundleCtx = pendingBundle;
    orders.set(ctx.saleNumber || ctx.orderNumber, finalizeBundle(ctx));
  }

  return Array.from(orders.values());
}

function getString(row: ParsedRow, key: string): string {
  const raw = row[key];
  if (raw === undefined || raw === null) return "";
  return String(raw).trim();
}

function getStringMulti(row: ParsedRow, ...keys: string[]): string {
  for (const key of keys) {
    const raw = row[key];
    if (raw !== undefined && raw !== null && String(raw).trim()) {
      return String(raw).trim();
    }
  }
  return "";
}

function getStringBySubstring(row: ParsedRow, substrings: string[]): string {
  const keys = Object.keys(row);
  for (const sub of substrings) {
    const key = keys.find((k) => k.toLowerCase().includes(sub.toLowerCase()));
    if (key) {
      const raw = row[key];
      if (raw !== undefined && raw !== null && String(raw).trim()) {
        return String(raw).trim();
      }
    }
  }
  return "";
}

function getInt(row: ParsedRow, key: string): number {
  const v = getString(row, key);
  const n = parseInt(v.replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function parseBRL(value: string): number {
  const cleaned = value.replace(/\s/g, "").trim();
  if (!cleaned) return 0;

  let normalized = cleaned.replace(/[R$\s]/g, "");

  if (normalized.includes(",")) {
    // Brazilian format: 1.234,56 or 1234,56
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (normalized.includes(".")) {
    // Could be US format (1234.56 from xlsx numeric) or Brazilian thousands (1.234)
    const dotCount = (normalized.match(/\./g) || []).length;
    const afterLastDot = normalized.slice(normalized.lastIndexOf(".") + 1);

    if (dotCount === 1 && afterLastDot.length >= 1 && afterLastDot.length <= 2) {
      // Single dot with 1-2 digits: US decimal format, keep as-is
    } else {
      // Multiple dots or thousands: remove dots
      normalized = normalized.replace(/\./g, "");
    }
  }

  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function cleanDocument(value: string): string {
  return value.replace(/[^\d]/g, "");
}

function cleanCEP(value: string): string {
  return value.replace(/[^\d-]/g, "").slice(0, 9);
}

const MONTHS_PT: Record<string, string> = {
  janeiro: "01", fevereiro: "02", março: "03", abril: "04",
  maio: "05", junho: "06", julho: "07", agosto: "08",
  setembro: "09", outubro: "10", novembro: "11", dezembro: "12",
};

function parseExcelDate(value: string | Date): string {
  if (!value) return "";
  if (typeof value !== "string") {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  const brDate = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (brDate) return `${brDate[3]}-${brDate[2]}-${brDate[1]}`;
  const brLong = text.match(/(\d{1,2})\s+de\s+(\S+?)(?:\s+de\s+(\d{4}))?(?:\s*[|]\s*\d{2}:\d{2})?$/i);
  if (brLong) {
    const month = MONTHS_PT[brLong[2].toLowerCase()];
    if (month) {
      const year = brLong[3] || new Date().getFullYear().toString();
      return `${year}-${month}-${brLong[1].padStart(2, "0")}`;
    }
  }
  const n = Number(text);
  if (Number.isFinite(n) && n > 40000 && n < 60000) {
    const epoch = new Date((n - 25569) * 86400 * 1000);
    return epoch.toISOString().slice(0, 10);
  }
  return text;
}