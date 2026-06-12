import { randomUUID } from "node:crypto";
import { db } from "./db.js";

interface MpCsvRow {
  sourceId: string;
  realAmount: number;
  settlementDate: string;
  packId: string;
  transactionAmount: number;
  feeAmount: number;
  transactionDate: string;
  orderId: string;
  productSku: string;
  saleDetail: string;
  paymentMethod: string;
  taxesAmount: number;
  businessUnit: string;
  subUnit: string;
  transactionType: string;
}

export interface MpPreviewRow {
  key: string;
  sourceId: string;
  date: string;
  type: "income" | "expense";
  category: string;
  description: string;
  amountCents: number;
  orderId: number | null;
  orderExternalId: string | null;
  status: "new" | "duplicate" | "no_match";
  skipped: boolean;
  skipReason?: string;
}

export interface MpPreviewWarning {
  orderId: number;
  externalId: string;
  receivedCents: number;
  expectedCents: number;
  diffCents: number;
}

export interface MpPreviewData {
  token: string;
  rows: MpPreviewRow[];
  summary: {
    total: number;
    income: number;
    expense: number;
    duplicated: number;
    linked: number;
    noMatch: number;
    skipped: number;
  };
  warnings: MpPreviewWarning[];
}

export interface MpImportResult {
  imported: number;
  duplicated: number;
  errors: { line: number; message: string }[];
}

function parseCsv(text: string): MpCsvRow[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(";");
  const colIndex = (name: string) => header.indexOf(name);
  const cols = {
    sourceId: colIndex("SOURCE_ID"),
    realAmount: colIndex("REAL_AMOUNT"),
    settlementDate: colIndex("SETTLEMENT_DATE"),
    packId: colIndex("PACK_ID"),
    transactionAmount: colIndex("TRANSACTION_AMOUNT"),
    feeAmount: colIndex("FEE_AMOUNT"),
    transactionDate: colIndex("TRANSACTION_DATE"),
    orderId: colIndex("ORDER_ID"),
    productSku: colIndex("PRODUCT_SKU"),
    saleDetail: colIndex("SALE_DETAIL"),
    paymentMethod: colIndex("PAYMENT_METHOD"),
    taxesAmount: colIndex("TAXES_AMOUNT"),
    businessUnit: colIndex("BUSINESS_UNIT"),
    subUnit: colIndex("SUB_UNIT"),
    transactionType: colIndex("TRANSACTION_TYPE"),
  };

  function parseValue(raw: string): string {
    let s = raw.trim();
    if (s.startsWith('"') && s.endsWith('"')) {
      s = s.slice(1, -1).replace(/""/g, '"');
    }
    return s;
  }

  function getField(row: string[], idx: number): string {
    if (idx < 0 || idx >= row.length) return "";
    return parseValue(row[idx]);
  }

  const rows: MpCsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(";");
    const r: MpCsvRow = {
      sourceId: getField(parts, cols.sourceId),
      realAmount: parseFloat(getField(parts, cols.realAmount)) || 0,
      settlementDate: getField(parts, cols.settlementDate),
      packId: getField(parts, cols.packId),
      transactionAmount: parseFloat(getField(parts, cols.transactionAmount)) || 0,
      feeAmount: parseFloat(getField(parts, cols.feeAmount)) || 0,
      transactionDate: getField(parts, cols.transactionDate),
      orderId: getField(parts, cols.orderId),
      productSku: getField(parts, cols.productSku),
      saleDetail: getField(parts, cols.saleDetail),
      paymentMethod: getField(parts, cols.paymentMethod),
      taxesAmount: parseFloat(getField(parts, cols.taxesAmount)) || 0,
      businessUnit: getField(parts, cols.businessUnit),
      subUnit: getField(parts, cols.subUnit),
      transactionType: getField(parts, cols.transactionType),
    };
    rows.push(r);
  }
  return rows;
}

export function previewMpCsv(text: string): MpPreviewData {
  const allRows = parseCsv(text);

  const disputeSourceIds = new Set<string>();
  for (const r of allRows) {
    if (r.transactionType === "DISPUTE" || r.transactionType === "DISPUTE_SHIPPING") {
      disputeSourceIds.add(r.sourceId);
    }
  }

  const dedupKey = (sid: string, cents: number, type: string) => `${sid}|${cents}|${type}`;
  const dedupSet = new Set<string>();
  try {
    const existing = db.prepare(
      "select source_id, amount_cents, type from transactions where source_type = 'mp_settlement' and source_id is not null"
    ).all() as { source_id: string; amount_cents: number; type: string }[];
    for (const r of existing) dedupSet.add(dedupKey(r.source_id, r.amount_cents, r.type));
  } catch {
    // column may not exist yet, treat all as new
  }

  const makeKey = (sourceId: string, transactionDate: string) => `${sourceId}_${transactionDate}`;

  const rows: MpPreviewRow[] = [];
  let income = 0, expense = 0, duplicated = 0, linked = 0, noMatch = 0, skipped = 0;

  for (const r of allRows) {
    const isDispute = r.transactionType === "DISPUTE" || r.transactionType === "DISPUTE_SHIPPING";
    const isSettlement = r.transactionType === "SETTLEMENT" || r.transactionType === "SETTLEMENT_SHIPPING";

    if (isDispute && r.realAmount < 0) {
      const cents = Math.round(Math.abs(r.realAmount) * 100);
      const dedup = dedupKey(r.sourceId, cents, "expense");
      if (dedupSet.has(dedup)) { duplicated++; continue; }
      const orderInfo = resolveOrder(r);
      const row: MpPreviewRow = {
        key: makeKey(r.sourceId, r.transactionDate),
        sourceId: r.sourceId,
        date: r.settlementDate.slice(0, 10),
        type: "expense",
        category: "Estorno/Reembolso",
        description: `Estorno - ${r.saleDetail || r.transactionType}`,
        amountCents: cents,
        orderId: orderInfo?.id ?? null,
        orderExternalId: orderInfo?.externalId ?? null,
        status: "new",
        skipped: false,
      };
      rows.push(row);
      expense += cents;
      if (orderInfo) linked++; else noMatch++;
      continue;
    }

    if (!isSettlement) { skipped++; continue; }

    if (disputeSourceIds.has(r.sourceId)) { skipped++; continue; }

    const hasPackId = r.packId.length > 0;
    const hasOrderId = r.orderId.length > 0;
    if (!hasPackId && !hasOrderId) { skipped++; continue; }

    if (r.realAmount <= 0) { skipped++; continue; }

    const cents = Math.round(Math.abs(r.realAmount) * 100);
    const dedup = dedupKey(r.sourceId, cents, "income");
    if (dedupSet.has(dedup)) { duplicated++; continue; }

    const orderInfo = resolveOrder(r);
    const row: MpPreviewRow = {
      key: makeKey(r.sourceId, r.transactionDate),
      sourceId: r.sourceId,
      date: r.settlementDate.slice(0, 10),
      type: "income",
      category: "Vendas",
      description: orderInfo
        ? `Venda - ${r.saleDetail || r.productSku || "ML"}`
        : `Venda externa - ${r.saleDetail || "WhatsApp/Link"}`,
      amountCents: cents,
      orderId: orderInfo?.id ?? null,
      orderExternalId: orderInfo?.externalId ?? null,
      status: orderInfo ? "new" : "no_match",
      skipped: false,
    };
    rows.push(row);
    income += cents;
    if (orderInfo) linked++; else noMatch++;
  }

  /* Warnings: discrepância entre valor recebido × esperado por pedido */
  const orderIncome = new Map<number, { received: number; externalId: string }>();
  for (const r of rows) {
    if (r.type === "income" && r.orderId) {
      const prev = orderIncome.get(r.orderId) ?? { received: 0, externalId: r.orderExternalId ?? "" };
      prev.received += r.amountCents;
      orderIncome.set(r.orderId, prev);
    }
  }
  const warnings: MpPreviewWarning[] = [];
  const expectedStmt = db.prepare(`
    select (products_amount_cents + shipping_customer_cents - shipping_total_cents - platform_fee_cents - other_costs_cents + discount_cents) as expected
    from order_financials where order_id = ?
  `);
  for (const [orderId, { received, externalId }] of orderIncome) {
    const row = expectedStmt.get([orderId]) as { expected: number } | undefined;
    if (!row) continue;
    const expected = row.expected;
    const diff = received - expected;
    const threshold = Math.max(100, Math.abs(expected) * 0.05);
    if (Math.abs(diff) > threshold) {
      warnings.push({ orderId, externalId, receivedCents: received, expectedCents: expected, diffCents: diff });
    }
  }

  const token = randomUUID();
  const cache = mpImportCache;
  cache.set(token, { rows, timestamp: Date.now() });
  setTimeout(() => { if (cache.has(token)) cache.delete(token); }, 10 * 60 * 1000);

  return {
    token,
    rows,
    warnings,
    summary: {
      total: rows.length,
      income,
      expense,
      duplicated,
      linked,
      noMatch,
      skipped,
    },
  };
}

function resolveOrder(r: MpCsvRow): { id: number; externalId: string } | null {
  const packId = r.packId.trim();
  const orderId = r.orderId.trim();

  if (packId) {
    const row = db.prepare("select id, external_order_id from orders where external_order_id = ?").get([packId]) as any;
    if (row) return { id: row.id, externalId: row.external_order_id };
  }

  if (orderId) {
    const row = db.prepare("select id, external_order_id from orders where external_order_id = ?").get([orderId]) as any;
    if (row) return { id: row.id, externalId: row.external_order_id };
  }

  return null;
}

const mpImportCache = new Map<string, { rows: MpPreviewRow[]; timestamp: number }>();

export function confirmMpImport(token: string, selectedKeys: string[]): MpImportResult {
  const cached = mpImportCache.get(token);
  if (!cached) throw new Error("Sessão expirada. Faça o preview novamente.");
  mpImportCache.delete(token);

  let filtered = cached.rows;
  if (selectedKeys.length > 0) {
    const keySet = new Set(selectedKeys);
    filtered = filtered.filter(r => keySet.has(r.key));
  }

  const errors: MpImportResult["errors"] = [];
  let imported = 0;
  let duplicated = 0;

  const insertTx = db.prepare(`
    insert into transactions (date, type, category, description, amount_cents, source_id, source_type, account, external_tx_number)
    values (?, ?, ?, ?, ?, ?, 'mp_settlement', 'Mercado Pago', ?)
  `);

  const insertLink = db.prepare(`
    insert or ignore into transaction_orders (transaction_id, order_id) values (?, ?)
  `);

  const checkDedup = db.prepare(`
    select id from transactions where source_id = ? and amount_cents = ? and type = ?
  `);

  for (const row of filtered) {
    try {
      if (row.skipped) continue;

      const existing = checkDedup.get([row.sourceId, row.amountCents, row.type]) as any;
      if (existing) { duplicated++; continue; }

      const result = insertTx.run(
        row.date, row.type, row.category, row.description, row.amountCents, row.sourceId, row.sourceId
      );
      const txId = Number(result.lastInsertRowid);

      if (row.orderId) {
        insertLink.run(txId, row.orderId);
      }

      imported++;
    } catch (err) {
      errors.push({ line: 0, message: (err as Error).message });
    }
  }

  return { imported, duplicated, errors };
}
