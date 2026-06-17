import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { importMercadoLivre, type ImportResult } from "../importer.js";
import type { ParsedOrder } from "../xlsxParser.js";
import { previewMpCsv, confirmMpImport } from "../importerMp.js";
import { mapStatus } from "../importShared.js";
import { computeCupomCents, matchProductByTitle } from "../financials.js";
import { all, get } from "./helpers.js";

const importCache = new Map<string, { orders: ParsedOrder[]; timestamp: number; fileName: string }>();

const importProgress = new Map<string, {
  current: number;
  total: number;
  status: "running" | "done" | "error";
  result?: ImportResult;
  error?: string;
  _ts?: number;
}>();

export default function registerImportRoutes(app: FastifyInstance) {
  setInterval(() => {
    const now = Date.now();
    for (const [key, val] of importCache) {
      if (now - val.timestamp > 30 * 60 * 1000) importCache.delete(key);
    }
  }, 5 * 60 * 1000);

  setInterval(() => {
    const now = Date.now();
    for (const [key, val] of importProgress) {
      if (val.status !== "running" && now - (val._ts ?? 0) > 60 * 1000) importProgress.delete(key);
    }
  }, 30 * 1000);

  app.post("/api/imports/preview", async (request, reply) => {
    try {
      const data = await request.file();
      if (!data) {
        reply.code(400);
        return { error: "Arquivo não enviado" };
      }
      const fileBuffer = Buffer.from(await data.toBuffer());
      const { parseMercadoLivreXlsx } = await import("../xlsxParser.js");
      const parseResult = parseMercadoLivreXlsx(fileBuffer);
      const orders = parseResult.orders;

      const salesChannelId = (get("select id from sales_channels where name = 'Mercado Livre'") as any)?.id ?? 1;
      const allStatuses = (db.prepare("select id, name from order_statuses").all() as { id: number; name: string }[]);
      const statusMap = new Map(allStatuses.map(s => [s.name.toLowerCase(), s.id]));

      let duplicated = 0;
      const errors: { row: number; message: string }[] = [];

      for (const info of parseResult.infoRows) {
        errors.push({ row: info.rowNumber, message: info.error });
      }

      const missingSkuSet = new Set<string>();
      const allSkus = new Set<string>();
      for (const o of orders) {
        for (const item of o.items) {
          if (item.sku) allSkus.add(item.sku);
        }
      }
      for (const sku of allSkus) {
        const exists = get("select id from products where sku = ?", [sku]);
        if (!exists) missingSkuSet.add(sku);
      }

      const unmatchedTitlesSet = new Set<string>();
      const productList = (all("select id, name, sku, current_cost_cents from products") as { id: number; name: string; sku: string; current_cost_cents: number }[]).map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        costCents: p.current_cost_cents,
      }));
      for (const o of orders) {
        for (const item of o.items) {
          if (item.sku || !item.title) continue;
          const matched = matchProductByTitle(productList, item.title);
          if (!matched) unmatchedTitlesSet.add(item.title.trim());
        }
      }

      const sales = orders.map((o) => {
        const key = o.saleNumber || o.orderNumber;
        const existing = get(`select o.id, o.status_id, o.status_description,
          of.products_amount_cents, of.shipping_total_cents, of.shipping_customer_cents,
          of.platform_fee_cents, of.discount_cents, of.other_costs_cents, of.amount_received_cents,
          of.packaging_cents,
          o.delivery_forecast_date, o.delivered_date,
          (select count(*) from order_items where order_id = o.id) as item_count
          from orders o join order_financials of on of.order_id = o.id
          where o.external_order_id = ? and o.sales_channel_id = ?`, [key, salesChannelId]) as any;
        const changes: { field: string; from: string; to: string }[] = [];
        let isDuplicate = false;
        if (existing) {
          const orderStatusId = mapStatus(o.status, o.statusDescription, statusMap, 1);
          const oldStatusName = (get("select name from order_statuses where id = ?", [existing.status_id]) as any)?.name ?? String(existing.status_id);
          const newStatusName = (get("select name from order_statuses where id = ?", [orderStatusId]) as any)?.name ?? String(orderStatusId);

          if (existing.status_id !== orderStatusId) {
            changes.push({ field: "Status", from: oldStatusName, to: newStatusName });
          }
          if (existing.status_description !== o.statusDescription) {
            changes.push({ field: "Descrição", from: existing.status_description, to: o.statusDescription });
          }
          if (existing.products_amount_cents !== o.financials.productsRevenue) {
            changes.push({ field: "Receita produtos", from: String(existing.products_amount_cents / 100), to: String(o.financials.productsRevenue / 100) });
          }
          if (existing.shipping_total_cents !== Math.abs(o.financials.shippingFee)) {
            changes.push({ field: "Frete total", from: String(existing.shipping_total_cents / 100), to: String(Math.abs(o.financials.shippingFee) / 100) });
          }
          if (existing.shipping_customer_cents !== o.financials.shippingRevenue) {
            changes.push({ field: "Frete recebido", from: String(existing.shipping_customer_cents / 100), to: String(o.financials.shippingRevenue / 100) });
          }
          if (existing.platform_fee_cents !== Math.abs(o.financials.platformFee)) {
            changes.push({ field: "Taxa plataforma", from: String(existing.platform_fee_cents / 100), to: String(Math.abs(o.financials.platformFee) / 100) });
          }
          if (existing.discount_cents !== Math.abs(o.financials.discount)) {
            changes.push({ field: "Desconto", from: String(existing.discount_cents / 100), to: String(Math.abs(o.financials.discount) / 100) });
          }
          const newCupomCents = computeCupomCents(o.financials, false);
          if (existing.other_costs_cents !== newCupomCents) {
            changes.push({ field: "Cupom", from: String(existing.other_costs_cents / 100), to: String(newCupomCents / 100) });
          }
          const existingItemCount = (get("select count(*) as c from order_items where order_id = ?", [existing.id]) as any)?.c ?? 0;
          if (existingItemCount !== o.items.length) {
            changes.push({ field: "Itens", from: String(existingItemCount), to: String(o.items.length) });
          }

          const existingForecast = existing.delivery_forecast_date || null;
          const newForecast = o.delivery?.sentDate || null;
          if (existingForecast !== newForecast) {
            changes.push({ field: "Previsão entrega", from: existingForecast || "—", to: newForecast || "—" });
          }
          const existingDelivered = existing.delivered_date || null;
          const newDelivered = o.delivery?.deliveredDate || null;
          if (existingDelivered !== newDelivered) {
            changes.push({ field: "Data entrega", from: existingDelivered || "—", to: newDelivered || "—" });
          }

          if (changes.length === 0) {
            duplicated++;
            isDuplicate = true;
          }
        }

        const hasMissingSku = o.items.some(i => (i.sku && missingSkuSet.has(i.sku)) || (!i.sku && i.title && unmatchedTitlesSet.has(i.title.trim())));

        return {
          saleNumber: o.saleNumber,
          orderNumber: o.orderNumber,
          buyer: o.buyerName,
          status: o.statusDescription,
          total: o.financials.total,
          items: o.items.map(i => ({ sku: i.sku, title: i.title, quantity: i.quantity, unitPrice: i.unitPrice })),
          document: o.document,
          hasMissingSku,
          existingOrderId: existing?.id ?? null,
          hasChanges: changes.length > 0,
          isDuplicate,
          changes,
        };
      }).filter(Boolean) as any[];

      const token = randomUUID();
      importCache.set(token, { orders, timestamp: Date.now(), fileName: data.filename });

      return {
        token,
        sales,
        summary: {
          foundOrders: orders.length,
          parsedRows: parseResult.infoRows.length,
          newCustomers: 0,
          existingCustomers: 0,
          duplicated,
          missingSkus: missingSkuSet.size + unmatchedTitlesSet.size,
        },
        missingSkusList: [...missingSkuSet],
        unmatchedTitlesList: [...unmatchedTitlesSet],
        newCustomerNames: [] as string[],
        errors,
        customerCountNote: "Contagem de clientes disponível apenas após a importação",
      };
    } catch (error) {
      console.error("PREVIEW ERROR:", error);
      const status = (error as any).statusCode ?? (error as any).status ?? 400;
      reply.code(status);
      return { error: (error as Error).message };
    }
  });

  app.post("/api/imports/validate", async (request, reply) => {
    try {
      const data = await request.file();
      if (!data) {
        reply.code(400);
        return { error: "Arquivo não enviado" };
      }
      const fileBuffer = Buffer.from(await data.toBuffer());
      const { read, utils } = await import("xlsx");
      const workbook = read(fileBuffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        return { valid: false, format: null };
      }
      const rows: string[][] = utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" }) as string[][];
      const hasHeader = rows.some(row =>
        ["N.º de venda", "Pedido de compra", "Data da venda"].some(h => row.some(c => String(c).trim() === h))
      );
      return { valid: hasHeader, format: hasHeader ? "Mercado Livre" : null };
    } catch (error) {
      console.error("VALIDATE ERROR:", error);
      return { valid: false, format: null };
    }
  });

  app.post("/api/imports/confirm", async (request, reply) => {
    try {
      const { token, selectedKeys } = z.object({
        token: z.string().min(1),
        selectedKeys: z.array(z.string()).optional(),
      }).parse(request.body);

      const cached = importCache.get(token);
      if (!cached) {
        reply.code(400);
        return { error: "Sessão expirada. Faça o preview novamente." };
      }
      importCache.delete(token);

      let orders = cached.orders;
      if (selectedKeys && selectedKeys.length > 0) {
        const keySet = new Set(selectedKeys);
        orders = orders.filter(o => keySet.has(o.saleNumber || o.orderNumber));
      }

      const progressToken = randomUUID();
      const total = orders.length;
      const entry: { current: number; total: number; status: "running" | "done" | "error"; _ts: number; result?: ImportResult; error?: string } = { current: 0, total, status: "running", _ts: Date.now() };
      importProgress.set(progressToken, entry);

      importMercadoLivre(orders, cached.fileName, (current) => {
        entry.current = current;
      }).then((result) => {
        entry.status = "done";
        entry.result = result;
        entry._ts = Date.now();
      }).catch((err) => {
        entry.status = "error";
        entry.error = (err as Error).message;
        entry._ts = Date.now();
      });

      return { progressToken };
    } catch (error) {
      console.error("IMPORT ENDPOINT ERROR:", error);
      reply.code(400);
      return { error: (error as Error).message };
    }
  });

  app.get("/api/imports/progress/:token", (request, reply) => {
    const token = (request.params as { token: string }).token;
    const entry = importProgress.get(token);
    if (!entry) {
      reply.code(404);
      return { error: "Importação não encontrada" };
    }
    return {
      current: entry.current,
      total: entry.total,
      status: entry.status,
      result: entry.result,
      error: entry.error,
    };
  });

  app.post("/api/imports/mp/preview", async (request, reply) => {
    try {
      const data = await request.file();
      if (!data) {
        reply.code(400);
        return { error: "Arquivo não enviado" };
      }
      const fileBuffer = Buffer.from(await data.toBuffer());
      const text = fileBuffer.toString("utf-8");
      return previewMpCsv(text);
    } catch (error) {
      console.error("MP PREVIEW ERROR:", error);
      reply.code(400);
      return { error: (error as Error).message };
    }
  });

  app.post("/api/imports/mp/confirm", async (request, reply) => {
    try {
      const { token, selectedKeys } = z.object({
        token: z.string().min(1),
        selectedKeys: z.array(z.string()).optional().default([]),
      }).parse(request.body);
      return confirmMpImport(token, selectedKeys);
    } catch (error) {
      console.error("MP CONFIRM ERROR:", error);
      reply.code(400);
      return { error: (error as Error).message };
    }
  });

  app.get("/api/import-log", (request) => {
    const query = request.query as Record<string, unknown>;
    const limit = query.limit ? Number(query.limit) : 20;
    const offset = query.offset ? Number(query.offset) : 0;
    const total = (db.prepare("select count(*) as c from import_log").get() as any)?.c ?? 0;
    const data = db.getImportLog(limit, offset);
    return { data, total };
  });
}
