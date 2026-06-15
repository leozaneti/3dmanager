import fs from "node:fs";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { z } from "zod";
import { calculateOrderTotals } from "./calculations.js";
import { db, migrate, moneyFields, TX_ID } from "./db.js";
import { importMercadoLivre, type ImportResult } from "./importer.js";
import type { ParsedOrder } from "./xlsxParser.js";
import { previewMpCsv, confirmMpImport } from "./importerMp.js";
import { hashPassword, verifyPassword, createSession, deleteSession, validateSession, clearExpiredSessions } from "./auth.js";
import { authMiddleware } from "./middleware/auth.js";
import { mapStatus } from "./importShared.js";
import { STATUS_TRANSITIONS, loadStatuses, getStatusId, isDevolvido, isValidStatusId, resolveTransitions, getStatusName } from "./statusConfig.js";

const app = Fastify({ logger: true });
const AUTH_ENABLED = process.env.AUTH_ENABLED === "true";

app.setErrorHandler((error, request, reply) => {
  console.error("UNHANDLED ERROR:", error.message, error.stack?.split("\n")[1]);
  reply.status(error.statusCode ?? 500).send({ error: error.message });
});

await app.register(cors, { origin: true });
await app.register(multipart, {
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }
});
await app.register(rateLimit, {
  global: false,
  max: 300,
  timeWindow: "1 minute"
});

const frontendDir = path.resolve("dist");
if (fs.existsSync(frontendDir)) {
  await app.register(fastifyStatic, {
    root: frontendDir,
    prefix: "/",
    wildcard: false
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
      reply.status(404).send({ error: "Not Found" });
    } else {
      reply.sendFile("index.html");
    }
  });
}

migrate();
loadStatuses();

clearExpiredSessions();
setInterval(clearExpiredSessions, 60 * 60 * 1000);

if (AUTH_ENABLED) {
  app.addHook("preHandler", authMiddleware);
}

app.post("/api/auth/setup", async (request, reply) => {
  if (!AUTH_ENABLED) { reply.code(404).send({ error: "Auth desabilitada" }); return; }
  const existing = get<{ value: string }>("select value from settings where key = 'admin_password_hash'");
  if (existing?.value) {
    reply.code(409);
    return { error: "Senha já configurada" };
  }
  const { password } = z.object({ password: z.string().min(4).max(128) }).parse(request.body);
  const hash = hashPassword(password);
  db.prepare("insert or replace into settings (key, value) values ('admin_password_hash', ?)").run(hash);
  db.log("create", "auth", 0, "Senha administrativa configurada");
  const token = createSession();
  reply.header("Set-Cookie", `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
  return { ok: true };
});

app.get("/api/auth/status", async (request, reply) => {
  if (!AUTH_ENABLED) return { enabled: false, configured: false, authenticated: true };
  const existing = get<{ value: string }>("select value from settings where key = 'admin_password_hash'");
  const configured = !!existing?.value;
  if (!configured) return { enabled: true, configured: false, authenticated: false };
  const cookie = request.headers.cookie ?? "";
  const match = cookie.match(/\bsession=([a-f0-9]+)/);
  const authenticated = match ? validateSession(match[1]) : false;
  return { enabled: true, configured: true, authenticated };
});

app.post("/api/auth/login", {
  config: { rateLimit: { max: 5, timeWindow: "15 minutes" } }
}, async (request, reply) => {
  if (!AUTH_ENABLED) { reply.code(404).send({ error: "Auth desabilitada" }); return; }
  const { password } = z.object({ password: z.string().min(1) }).parse(request.body);
  const stored = get<{ value: string }>("select value from settings where key = 'admin_password_hash'");
  if (!stored?.value) {
    reply.code(400);
    return { error: "Nenhuma senha configurada. Acesse /setup primeiro." };
  }
  if (!verifyPassword(password, stored.value)) {
    reply.code(401);
    return { error: "Senha incorreta" };
  }
  const token = createSession();
  reply.header("Set-Cookie", `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
  return { ok: true };
});

app.post("/api/auth/logout", async (request, reply) => {
  if (!AUTH_ENABLED) { reply.code(404).send({ error: "Auth desabilitada" }); return; }
  const cookie = request.headers.cookie ?? "";
  const match = cookie.match(/\bsession=([a-f0-9]+)/);
  if (match) deleteSession(match[1]);
  reply.header("Set-Cookie", "session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
  return { ok: true };
});

const importCache = new Map<string, { orders: ParsedOrder[]; timestamp: number; fileName: string }>();
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of importCache) {
    if (now - val.timestamp > 30 * 60 * 1000) importCache.delete(key);
  }
}, 5 * 60 * 1000);

const cents = z.coerce.number().int().default(0);
const optionalId = z.coerce.number().int().positive().nullable().optional();

function all<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return db.prepare(sql).all(params) as T[];
}

function get<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return db.prepare(sql).get(params) as T | undefined;
}

function boolRow<T extends Record<string, unknown>>(row: T) {
  return { ...row, active: Boolean(row.active) };
}

const storeSchema = z.object({
  name: z.string().min(1),
  active: z.coerce.boolean().default(true)
});

const productSchema = z.object({
  name: z.string().min(1),
  sku: z.string().min(1),
  currentCostCents: cents,
  weightGrams: z.coerce.number().int().default(0),
  printTimeMinutes: z.coerce.number().int().default(0),
  additionalCostCents: cents,
  active: z.coerce.boolean().default(true)
});

const productUpdateSchema = productSchema.extend({
  recalculate: z.enum(["none", "from_date", "all"]).optional().default("none"),
  recalculateFrom: z.string().optional(),
});

const customerSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional().default(""),
  email: z.string().optional().default(""),
  document: z.string().optional().default(""),
  cep: z.string().optional().default(""),
  logradouro: z.string().optional().default(""),
  numero: z.string().optional().default(""),
  complemento: z.string().optional().default(""),
  bairro: z.string().optional().default(""),
  cidade: z.string().optional().default(""),
  estado: z.string().optional().default(""),
  notes: z.string().optional().default("")
});

const orderItemSchema = z.object({
  productId: optionalId,
  sku: z.string().optional().default(""),
  listingTitle: z.string().optional().default(""),
  quantity: z.coerce.number().int().positive(),
  saleUnitPriceCents: cents,
  costUnitCents: cents
});

const orderSchema = z.object({
  storeId: z.coerce.number().int().positive(),
  externalOrderId: z.string().optional().default(""),
  saleDate: z.string().min(1),
  statusId: z.coerce.number().int().positive().refine(
    id => isValidStatusId(id),
    { message: "statusId inválido: deve corresponder a um status ativo" }
  ),
  statusDescription: z.string().optional().default(""),
  salesChannelId: z.coerce.number().int().positive(),
  customerId: optionalId,
  notes: z.string().optional().default(""),
  deliveryForecastDate: z.string().optional().default(""),
  deliveredDate: z.string().optional().default(""),
  financials: z.object({
    productsAmountCents: cents,
    shippingTotalCents: cents,
    shippingCustomerCents: cents,
    platformFeeCents: cents,
    discountCents: cents,
    otherCostsCents: cents,
    amountReceivedCents: cents.optional().default(0),
    packagingCents: cents,
    additionalCostsCents: cents
  }),
  items: z.array(orderItemSchema)
});

const todoColumnSchema = z.object({
  name: z.string().min(1).max(40),
  position: z.coerce.number().int().min(0).default(0),
  isDoneColumn: z.coerce.boolean().default(false)
});

const todoSchema = z.object({
  columnId: z.coerce.number().int().positive(),
  title: z.string().min(1).max(200),
  notes: z.string().max(2000).optional().default(""),
  position: z.coerce.number().int().min(0).default(0),
  priority: z.coerce.number().int().min(0).max(2).default(0),
  dueDate: z.string().nullable().optional()
});

const todoMoveSchema = z.object({
  columnId: z.coerce.number().int().positive(),
  position: z.coerce.number().int().min(0)
});

app.get("/api/meta", () => ({
  stores: all("select id, name, active from stores order by name").map(boolRow),
  channels: all("select id, name, active from sales_channels where active = 1 order by name"),
  statuses: all("select id, name, sort_order as sortOrder, is_final as isFinal from order_statuses where active = 1 order by sort_order"),
}));

app.get("/api/stores", () => all("select id, name, active from stores order by name").map(boolRow));
app.post("/api/imports/preview", async (request, reply) => {
  try {
    const data = await request.file();
    if (!data) {
      reply.code(400);
      return { error: "Arquivo não enviado" };
    }
    const fileBuffer = Buffer.from(await data.toBuffer());
    const { parseMercadoLivreXlsx } = await import("./xlsxParser.js");
    const orders = parseMercadoLivreXlsx(fileBuffer);

    const salesChannelId = (get("select id from sales_channels where name = 'Mercado Livre'") as any)?.id ?? 1;
    const allStatuses = (db.prepare("select id, name from order_statuses").all() as { id: number; name: string }[]);
    const statusMap = new Map(allStatuses.map(s => [s.name.toLowerCase(), s.id]));

    let duplicated = 0;
    const errors: { row: number; message: string }[] = [];

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
    const productList = all("select id, name from products") as { id: number; name: string }[];
    const productNorms = productList.map(p => ({ ...p, norm: p.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() }));
    const stopwords = new Set(["de", "da", "do", "das", "dos", "para", "com", "uma", "um", "em", "no", "na", "por", "voce", "você", "sua", "seu", "mais", "pra", "que", "pro", "aos", "nas", "nos", "sem", "ate", "até", "ate", "lp", "a-z", "10"]);
    for (const o of orders) {
      for (const item of o.items) {
        if (item.sku || !item.title) continue;
        const titleNorm = item.title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        const keywords = titleNorm.split(/[\s,;:/()\[\]–—\-]+/).filter(w => w.length > 2 && !stopwords.has(w));
        if (keywords.length === 0) continue;
        let matched = false;
        for (const pn of productNorms) {
          if (!pn.norm.includes(keywords[0])) continue;
          let score = 0;
          for (const kw of keywords) {
            if (pn.norm.includes(kw)) score++;
          }
          const threshold = keywords.length === 2 ? 2 : Math.max(1, Math.ceil(keywords.length / 2));
          if (score >= threshold) { matched = true; break; }
        }
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
        const finSum = o.financials.productsRevenue + o.financials.shippingRevenue
                     + o.financials.platformFee + o.financials.shippingFee;
        const gap = o.financials.total - finSum - o.financials.discount;
        const newCupomCents = gap < 0 ? -gap : 0;
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
          return null;
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

const importProgress = new Map<string, {
  current: number;
  total: number;
  status: "running" | "done" | "error";
  result?: ImportResult;
  error?: string;
}>();

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of importProgress) {
    if (val.status !== "running" && now - (val as any)._ts > 60 * 1000) importProgress.delete(key);
  }
}, 30 * 1000);

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

/* ───── MP Settlement Import ───── */

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

app.get("/api/audit-log", (request) => {
  const query = request.query as Record<string, unknown>;
  const limit = query.limit ? Number(query.limit) : 50;
  const offset = query.offset ? Number(query.offset) : 0;
  const total = (db.prepare("select count(*) as c from audit_log").get() as any)?.c ?? 0;
  const data = db.getAuditLog(limit, offset);
  return { data, total };
});

app.post("/api/stores", async (request, reply) => {
  const data = storeSchema.parse(request.body);
  const result = db.prepare("insert into stores (name, active) values (?, ?)").run(data.name, data.active ? 1 : 0);
  db.log("create", "store", Number(result.lastInsertRowid), `Loja "${data.name}" criada`);
  reply.code(201);
  return { id: result.lastInsertRowid };
});

app.put("/api/stores/:id", async (request, reply) => {
  const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
  const existing = get("select id from stores where id = ?", [id]);
  if (!existing) {
    reply.code(404);
    return { error: "Loja não encontrada" };
  }
  const data = storeSchema.parse(request.body);
  db.prepare("update stores set name = ?, active = ?, updated_at = current_timestamp where id = ?").run(
    data.name,
    data.active ? 1 : 0,
    id
  );
  db.log("update", "store", id, `Loja "${data.name}" atualizada`);
  return { ok: true };
});

app.delete("/api/stores/:id", async (request, reply) => {
  const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
  const existingOrder = get("select 1 from orders where store_id = ? limit 1", [id]);
  if (existingOrder) {
    reply.code(409);
    return { error: "Não é possível excluir loja com pedidos existentes." };
  }
  db.prepare("delete from stores where id = ?").run(id);
  db.log("delete", "store", id, `Loja #${id} excluída`);
  return { ok: true };
});

app.get("/api/products", (request) => {
  const query = request.query as Record<string, unknown>;
  const search = query.search ? String(query.search) : "";
  const limit = query.limit ? Number(query.limit) : 0;
  const offset = query.offset ? Number(query.offset) : 0;
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (search) {
    conditions.push("(p.name like ? or p.sku like ?)");
    params.push(`%${search}%`, `%${search}%`);
  }
  const where = conditions.length ? "where " + conditions.join(" and ") : "";
  const total = (get(`select count(*) as c from products p ${where}`, params) as any)?.c ?? 0;
  const data = all(
    `select ${moneyFields.product},
      min(psp.sale_price_cents) as minSalePriceCents,
      max(psp.sale_price_cents) as maxSalePriceCents,
      min(psp.net_received_cents) as minNetReceivedCents
    from products p
    left join product_sale_prices psp on psp.product_id = p.id
    ${where}
    group by p.id
    order by p.active desc, p.name
    ${limit ? `limit ${limit} offset ${offset}` : ""}`,
    params
  ).map(boolRow);
  return { data, total };
});

app.get("/api/settings", () => {
  const rows = all<{ key: string; value: string; description: string }>("select key, value, description from settings where key != 'admin_password_hash' and key not like 'schema_%'");
  const order = ["pla_price_per_kg", "energy_cost_per_hour", "machine_value", "machine_lifespan_hours", "maintenance_factor", "error_rate", "packaging_cost"];
  rows.sort((a: any, b: any) => {
    const ia = order.indexOf(a.key);
    const ib = order.indexOf(b.key);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
  return rows.reduce<Record<string, { value: string; description: string }>>((acc, row) => {
    acc[row.key] = { value: row.value, description: row.description };
    return acc;
  }, {});
});

app.put("/api/settings", async (request) => {
  const data = request.body as Record<string, { value: string }>;
  const stmt = db.prepare("update settings set value = ?, updated_at = current_timestamp where key = ?");
  for (const [key, val] of Object.entries(data)) {
    stmt.run(val.value, key);
  }
  return { ok: true };
});

app.post("/api/products", async (request, reply) => {
  const data = productSchema.parse(request.body);
  const result = db
    .prepare(
      `insert into products (name, sku, current_cost_cents, weight_grams, print_time_minutes, additional_cost_cents, active)
       values (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.name, data.sku, data.currentCostCents,
      data.weightGrams, data.printTimeMinutes, data.additionalCostCents,
      data.active ? 1 : 0
    );
  db.log("create", "product", Number(result.lastInsertRowid), `Produto "${data.name}" (${data.sku}) criado`);
  reply.code(201);
  return { id: result.lastInsertRowid };
});

app.put("/api/products/:id", async (request) => {
  const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
  const data = productUpdateSchema.parse(request.body);
  db.prepare(
    `update products set
      name = ?, sku = ?, current_cost_cents = ?,
      weight_grams = ?, print_time_minutes = ?, additional_cost_cents = ?,
      active = ?, updated_at = current_timestamp
     where id = ?`
  ).run(
    data.name, data.sku, data.currentCostCents,
    data.weightGrams, data.printTimeMinutes, data.additionalCostCents,
    data.active ? 1 : 0, id
  );
  if (data.recalculate === "all") {
    const count = (db.prepare("select changes() as c").get() as any)?.c ?? 0;
    db.prepare("update order_items set cost_unit_cents = ? where product_id = ?").run(data.currentCostCents, id);
  } else if (data.recalculate === "from_date" && data.recalculateFrom) {
    db.prepare(
      `update order_items set cost_unit_cents = ?
       where product_id = ? and order_id in (select id from orders where sale_date >= ?)`
    ).run(data.currentCostCents, id, data.recalculateFrom);
  }
  db.log("update", "product", id, `Produto "${data.name}" (${data.sku}) atualizado`);
  return { ok: true };
});

app.delete("/api/products/:id", async (request) => {
  const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
  const prod = get("select name from products where id = ?", [id]) as any;
  db.prepare("update order_items set product_id = null where product_id = ?").run(id);
  db.prepare("delete from products where id = ?").run(id);
  db.log("delete", "product", id, `Produto "${prod?.name ?? '#' + id}" excluído`);
  return { ok: true };
});

app.post("/api/products/bulk-delete", async (request, reply) => {
  const { ids } = z.object({ ids: z.array(z.number().int().positive()).nonempty() }).parse(request.body);
  for (const id of ids) {
    db.prepare("update order_items set product_id = null where product_id = ?").run(id);
    const prod = get("select name from products where id = ?", [id]) as any;
    db.prepare("delete from products where id = ?").run(id);
    db.log("delete", "product", id, `Produto "${prod?.name ?? '#' + id}" excluído (em lote)`);
  }
  return { ok: true, deleted: ids.length };
});

app.get("/api/products/:id/dependencies", (request) => {
  const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
  const product = get("select id, name from products where id = ?", [id]);
  if (!product) return { error: "Produto não encontrado" };
  const orderItemsCount = (get("select count(*) as c from order_items where product_id = ?", [id]) as any)?.c ?? 0;
  return { orderItemsCount };
});

app.get("/api/products/:id/prices", (request) => {
  const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
  return all(
    `select psp.sales_channel_id as salesChannelId, sc.name as salesChannelName,
       psp.sale_price_cents as salePriceCents, psp.net_received_cents as netReceivedCents
     from product_sale_prices psp
     join sales_channels sc on sc.id = psp.sales_channel_id
     where psp.product_id = ?`,
    [id]
  );
});

app.put("/api/products/:id/prices", async (request) => {
  const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
  const data = z.object({
    prices: z.array(z.object({
      salesChannelId: z.number().int().positive(),
      salePriceCents: cents,
      netReceivedCents: cents,
    }))
  }).parse(request.body);
  const stmt = db.prepare(
    `insert into product_sale_prices (product_id, sales_channel_id, sale_price_cents, net_received_cents) values (?, ?, ?, ?)
     on conflict (product_id, sales_channel_id) do update set sale_price_cents = excluded.sale_price_cents, net_received_cents = excluded.net_received_cents`
  );
  for (const price of data.prices) {
    stmt.run(id, price.salesChannelId, price.salePriceCents, price.netReceivedCents);
  }
  db.log("update", "product", id, `Preços de venda atualizados`);
  return { ok: true };
});

app.get("/api/customers", (request) => {
  const query = request.query as Record<string, unknown>;
  const search = query.search ? String(query.search) : "";
  const limit = query.limit ? Number(query.limit) : 0;
  const offset = query.offset ? Number(query.offset) : 0;
  const conditions: string[] = [];
  const params: unknown[] = [];
  const statsConditions: string[] = [];
  const statsParams: unknown[] = [];
  const hasDateFilter = Boolean(query.startDate || query.endDate);
  const hasOrderCountFilter = query.minOrders !== undefined || query.maxOrders !== undefined;
  if (search) {
    conditions.push("(c.name like ? or c.phone like ? or c.email like ? or c.document like ? or c.cidade like ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (query.startDate) {
    statsConditions.push("o.sale_date >= ?");
    statsParams.push(String(query.startDate));
  }
  if (query.endDate) {
    statsConditions.push("o.sale_date <= ?");
    statsParams.push(String(query.endDate));
  }
  if (query.state) {
    const UF_TO_STATE: Record<string, string> = {
      AC:"ACRE", AL:"ALAGOAS", AP:"AMAPÁ", AM:"AMAZONAS", BA:"BAHIA",
      CE:"CEARÁ", DF:"DISTRITO FEDERAL", ES:"ESPÍRITO SANTO", GO:"GOIÁS",
      MA:"MARANHÃO", MT:"MATO GROSSO", MS:"MATO GROSSO DO SUL", MG:"MINAS GERAIS",
      PA:"PARÁ", PB:"PARAÍBA", PR:"PARANÁ", PE:"PERNAMBUCO", PI:"PIAUÍ",
      RJ:"RIO DE JANEIRO", RN:"RIO GRANDE DO NORTE", RS:"RIO GRANDE DO SUL",
      RO:"RONDÔNIA", RR:"RORAIMA", SC:"SANTA CATARINA", SP:"SÃO PAULO",
      SE:"SERGIPE", TO:"TOCANTINS"
    };
    const stateName = UF_TO_STATE[String(query.state).toUpperCase()] ?? String(query.state);
    conditions.push("c.estado = ?");
    params.push(stateName);
  }
  if (query.hasOrders === "true") {
    conditions.push("s.orderCount > 0");
  } else if (query.hasOrders === "false") {
    conditions.push("s.orderCount IS NULL");
  }
  if (query.minOrders !== undefined) {
    const min = Number(query.minOrders);
    if (Number.isFinite(min) && min >= 0) {
      conditions.push("coalesce(s.orderCount, 0) >= ?");
      params.push(min);
    }
  }
  if (query.maxOrders !== undefined) {
    const max = Number(query.maxOrders);
    if (Number.isFinite(max) && max >= 0) {
      conditions.push("coalesce(s.orderCount, 0) <= ?");
      params.push(max);
    }
  }
  if (hasDateFilter && !hasOrderCountFilter) {
    conditions.push("coalesce(s.orderCount, 0) > 0");
  }
  if (query.inactiveDays) {
    const days = Number(query.inactiveDays);
    if (days > 0) {
      conditions.push("s.lastPurchase IS NOT NULL AND julianday('now') - julianday(s.lastPurchase) > ?");
      params.push(days);
    }
  }
  if (query.minRevenue) {
    const min = Number(query.minRevenue);
    if (min > 0) {
      conditions.push("coalesce(s.totalProductsAmountCents, 0) + coalesce(s.totalShippingCustomerCents, 0) >= ?");
      params.push(min);
    }
  }
  const where = conditions.length ? "where " + conditions.join(" and ") : "";
  const statsWhere = statsConditions.length ? "where " + statsConditions.join(" and ") : "";
  const statsSubquery = `
    select
      o.customer_id,
      count(*) as orderCount,
      min(o.sale_date) as firstPurchase,
      max(o.sale_date) as lastPurchase,
      sum(of.products_amount_cents) as totalProductsAmountCents,
      sum(of.shipping_customer_cents) as totalShippingCustomerCents,
      sum(of.shipping_total_cents) as totalShippingTotalCents,
      sum(of.platform_fee_cents) as totalPlatformFeeCents,
      sum(of.discount_cents) as totalDiscountCents,
      sum(of.other_costs_cents) as totalOtherCostsCents,
      sum(of.packaging_cents) as totalPackagingCents,
      sum(of.additional_costs_cents) as totalAdditionalCostsCents,
      coalesce(sum(oi_sum.item_cost), 0) as totalItemsCostCents
    from orders o
    join order_financials of on of.order_id = o.id
    left join (select order_id, sum(quantity * cost_unit_cents) as item_cost from order_items group by order_id) oi_sum on oi_sum.order_id = o.id
    ${statsWhere}
    group by o.customer_id
  `;
  const fromClause = `from customers c left join (${statsSubquery}) s on s.customer_id = c.id ${where}`;
  const selectClause = `
    c.id, c.name, c.phone, c.email, c.document, c.cep, c.logradouro, c.numero, c.complemento, c.bairro, c.cidade, c.estado, c.notes,
    coalesce(s.orderCount, 0) as orderCount,
    s.firstPurchase as firstPurchase, s.lastPurchase as lastPurchase,
    coalesce(s.totalProductsAmountCents, 0) as totalProductsAmountCents,
    coalesce(s.totalShippingCustomerCents, 0) as totalShippingCustomerCents,
    coalesce(s.totalShippingTotalCents, 0) as totalShippingTotalCents,
    coalesce(s.totalPlatformFeeCents, 0) as totalPlatformFeeCents,
    coalesce(s.totalDiscountCents, 0) as totalDiscountCents,
    coalesce(s.totalOtherCostsCents, 0) as totalOtherCostsCents,
    coalesce(s.totalPackagingCents, 0) as totalPackagingCents,
    coalesce(s.totalAdditionalCostsCents, 0) as totalAdditionalCostsCents,
    coalesce(s.totalItemsCostCents, 0) as totalItemsCostCents
  `;
  const queryParams = [...statsParams, ...params];
  const total = (get(`select count(*) as c ${fromClause}`, queryParams) as any)?.c ?? 0;
  const data = all(
    `select ${selectClause} ${fromClause} order by c.name ${limit ? `limit ${limit} offset ${offset}` : ""}`,
    queryParams
  );
  return { data, total };
});

app.post("/api/customers", async (request, reply) => {
  const data = customerSchema.parse(request.body);
  const result = db
    .prepare(
      "insert into customers (name, phone, email, document, cep, logradouro, numero, complemento, bairro, cidade, estado, notes) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      data.name, data.phone, data.email, data.document,
      data.cep, data.logradouro, data.numero, data.complemento,
      data.bairro, data.cidade, data.estado, data.notes
    );
  db.log("create", "customer", Number(result.lastInsertRowid), `Cliente "${data.name}" criado`);
  reply.code(201);
  return { id: result.lastInsertRowid };
});

app.put("/api/customers/:id", async (request, reply) => {
  const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
  const existing = get("select id from customers where id = ?", [id]);
  if (!existing) {
    reply.code(404);
    return { error: "Cliente não encontrado" };
  }
  const data = customerSchema.parse(request.body);
  db.prepare(
    "update customers set name = ?, phone = ?, email = ?, document = ?, cep = ?, logradouro = ?, numero = ?, complemento = ?, bairro = ?, cidade = ?, estado = ?, notes = ?, updated_at = current_timestamp where id = ?"
  ).run(
    data.name, data.phone, data.email, data.document,
    data.cep, data.logradouro, data.numero, data.complemento,
    data.bairro, data.cidade, data.estado, data.notes, id
  );
  db.log("update", "customer", id, `Cliente "${data.name}" atualizado`);
  return { ok: true };
});

app.delete("/api/customers/:id", async (request) => {
  const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
  const cust = get("select name from customers where id = ?", [id]) as any;
  db.prepare("update orders set customer_id = null where customer_id = ?").run(id);
  db.prepare("delete from customers where id = ?").run(id);
  db.log("delete", "customer", id, `Cliente "${cust?.name ?? '#' + id}" excluído`);
  return { ok: true };
});

app.post("/api/customers/bulk-delete", async (request, reply) => {
  const { ids } = z.object({ ids: z.array(z.number().int().positive()).nonempty() }).parse(request.body);
  for (const id of ids) {
    const cust = get("select name from customers where id = ?", [id]) as any;
    db.prepare("update orders set customer_id = null where customer_id = ?").run(id);
    db.prepare("delete from customers where id = ?").run(id);
    db.log("delete", "customer", id, `Cliente "${cust?.name ?? '#' + id}" excluído (em lote)`);
  }
  return { ok: true, deleted: ids.length };
});

app.get("/api/customers/:id/summary", (request, reply) => {
  const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
  const customer = get<Record<string, unknown>>("select id, name, phone, email, document, cep, logradouro, numero, complemento, bairro, cidade, estado, notes from customers where id = ?", [id]);
  if (!customer) {
    reply.code(404);
    return { error: "Cliente não encontrado" };
  }
  const orders = all<any>(
    `
      select
        o.id,
        o.sale_date as saleDate,
        o.status_id as statusId,
        os.name as statusName,
        sc.name as salesChannelName,
      o.sale_date as saleDate,
      of.products_amount_cents as productsAmountCents,
      of.shipping_total_cents as shippingTotalCents,
      of.shipping_customer_cents as shippingCustomerCents,
      of.platform_fee_cents as platformFeeCents,
      of.discount_cents as discountCents,
      of.other_costs_cents as otherCostsCents,
      of.amount_received_cents as amountReceivedCents,
      of.packaging_cents as packagingCents,
      of.additional_costs_cents as additionalCostsCents,
        coalesce(sum(oi.quantity * oi.cost_unit_cents), 0) as itemsCostCents
      from orders o
      join order_statuses os on os.id = o.status_id
      join sales_channels sc on sc.id = o.sales_channel_id
      join order_financials of on of.order_id = o.id
      left join order_items oi on oi.order_id = o.id
      where o.customer_id = ?
      group by o.id
      order by o.sale_date desc, o.id desc
    `,
    [id]
  ).map((row) => ({ ...row, totals: calculateOrderTotals(row) }));

  const activeOrders = orders.filter((o) => !isDevolvido(o.statusId));
  const totalOrders = activeOrders.length;
  const totalRevenueCents = activeOrders.reduce((s, o) => s + o.productsAmountCents, 0);
  const totalProfitCents = activeOrders.reduce((s, o) => s + o.totals.profitCents, 0);
  const firstPurchase = orders.length > 0 ? orders[orders.length - 1].saleDate : null;
  const lastPurchase = orders.length > 0 ? orders[0].saleDate : null;

  return { customer, orders, totalOrders, totalRevenueCents, totalProfitCents, firstPurchase, lastPurchase };
});

function orderListWhere(query: Record<string, unknown>) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (query.customerId) {
    conditions.push("o.customer_id = ?");
    params.push(Number(query.customerId));
  }
  if (query.storeId) {
    conditions.push("o.store_id = ?");
    params.push(Number(query.storeId));
  }
  if (query.channelId) {
    conditions.push("o.sales_channel_id = ?");
    params.push(Number(query.channelId));
  }
  if (query.from) {
    conditions.push("o.sale_date >= ?");
    params.push(String(query.from));
  }
  if (query.to) {
    conditions.push("o.sale_date <= ?");
    params.push(String(query.to));
  }
  if (query.statusId) {
    conditions.push("o.status_id = ?");
    params.push(Number(query.statusId));
  }
  if (query.search) {
    const s = `%${String(query.search)}%`;
    conditions.push(
      "(s.name like ? or os.name like ? or sc.name like ?" +
      " or c.name like ? or c.document like ? or c.cidade like ? or c.phone like ?" +
      " or o.external_order_id like ? or cast(o.id as text) like ?" +
      " or o.status_description like ? or o.notes like ?" +
      " or exists (select 1 from order_items oi where oi.order_id = o.id and (oi.sku like ? or oi.listing_title like ?)))"
    );
    params.push(s, s, s, s, s, s, s, s, s, s, s, s, s);
  }
  return { where: conditions.length ? `where ${conditions.join(" and ")}` : "", params };
}

app.get("/api/orders", (request) => {
  const query = request.query as Record<string, unknown>;
  const { where, params } = orderListWhere(query);
  const limit = query.limit ? Number(query.limit) : 0;
  const offset = query.offset ? Number(query.offset) : 0;
  const total = (get(
    `select count(*) as c from (select o.id from orders o
      join stores s on s.id = o.store_id
      join order_statuses os on os.id = o.status_id
      join sales_channels sc on sc.id = o.sales_channel_id
      left join customers c on c.id = o.customer_id
      ${where}
      group by o.id)`,
    params
  ) as any)?.c ?? 0;
  const activeTotal = (get(
    `select count(*) as c from (select o.id from orders o
      join stores s on s.id = o.store_id
      join order_statuses os on os.id = o.status_id
      join sales_channels sc on sc.id = o.sales_channel_id
      left join customers c on c.id = o.customer_id
      ${where}${where ? " and" : "where"} o.status_id != ${getStatusId("devolvido")}
      group by o.id)`,
    params
  ) as any)?.c ?? 0;
  const data = all(
        `select
      o.id, o.status_id as statusId, o.external_order_id as externalOrderId, o.sale_date as saleDate,
      o.delivery_forecast_date as deliveryForecastDate, o.delivered_date as deliveredDate,
      s.name as storeName, os.name as statusName, sc.name as salesChannelName,
      c.name as customerName, o.customer_id as customerId,
      (select group_concat(oi.sku || ' (×' || oi.quantity || ')', ', ') from order_items oi where oi.order_id = o.id) as items,
      of.products_amount_cents as productsAmountCents,
      of.shipping_total_cents as shippingTotalCents,
      of.shipping_customer_cents as shippingCustomerCents,
      of.platform_fee_cents as platformFeeCents,
      of.discount_cents as discountCents,
      of.other_costs_cents as otherCostsCents,
      of.amount_received_cents as amountReceivedCents,
      of.packaging_cents as packagingCents,
      of.additional_costs_cents as additionalCostsCents,
      coalesce(sum(oi.quantity * oi.cost_unit_cents), 0) as itemsCostCents
    from orders o
    join stores s on s.id = o.store_id
    join order_statuses os on os.id = o.status_id
    join sales_channels sc on sc.id = o.sales_channel_id
    left join customers c on c.id = o.customer_id
    join order_financials of on of.order_id = o.id
    left join order_items oi on oi.order_id = o.id
    ${where}
    group by o.id
    order by o.sale_date desc, o.id desc
    ${limit ? `limit ${limit} offset ${offset}` : ""}`,
    params
  ).map((row: any) => ({ ...row, totals: calculateOrderTotals(row) }));

  /* Aggregated totals across ALL orders matching the filter (inclui devolvidos) */
  const filterTotals = (get(
    `select
      count(*) as orderCount,
      coalesce(sum(of.products_amount_cents), 0) as productsAmountCents,
      coalesce(sum(of.shipping_total_cents), 0) as shippingTotalCents,
      coalesce(sum(of.shipping_customer_cents), 0) as shippingCustomerCents,
      coalesce(sum(of.platform_fee_cents), 0) as platformFeeCents,
      coalesce(sum(of.discount_cents), 0) as discountCents,
      coalesce(sum(of.other_costs_cents), 0) as otherCostsCents,
      coalesce(sum(of.amount_received_cents), 0) as amountReceivedCents,
      coalesce(sum(of.packaging_cents), 0) as packagingCents,
      coalesce(sum(of.additional_costs_cents), 0) as additionalCostsCents,
      coalesce(sum(oi_sum.item_cost), 0) as itemsCostCents
    from orders o
    join stores s on s.id = o.store_id
    join order_statuses os on os.id = o.status_id
    join sales_channels sc on sc.id = o.sales_channel_id
    left join customers c on c.id = o.customer_id
    join order_financials of on of.order_id = o.id
    left join (select order_id, sum(quantity * cost_unit_cents) as item_cost from order_items group by order_id) oi_sum on oi_sum.order_id = o.id
    ${where}`,
    params
  ) as any) ?? {};

  const activeOrderCount = (get(
    `select count(*) as c from (select o.id from orders o
      join stores s on s.id = o.store_id
      join order_statuses os on os.id = o.status_id
      join sales_channels sc on sc.id = o.sales_channel_id
      left join customers c on c.id = o.customer_id
      ${where}${where ? " and" : "where"} o.status_id != ${getStatusId("devolvido")}
      group by o.id)`,
    params
  ) as any)?.c ?? 0;

  const statusCounts = all(
    `select os.id, os.name, count(*) as count
     from orders o
     join stores s on s.id = o.store_id
     join order_statuses os on os.id = o.status_id
     join sales_channels sc on sc.id = o.sales_channel_id
     left join customers c on c.id = o.customer_id
     ${where}
     group by o.status_id
     order by os.id`,
    params
  ) as { id: number; name: string; count: number }[];

  return { data, total, activeTotal, filterTotals, activeOrderCount, statusCounts };
});

app.get("/api/orders/:id", (request, reply) => {
  const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
  const order = get(
    `
      select
        o.id, o.store_id as storeId, o.external_order_id as externalOrderId, o.sale_date as saleDate,
        o.status_id as statusId, o.status_description as statusDescription, o.sales_channel_id as salesChannelId,
        o.customer_id as customerId, o.notes,
        o.delivery_forecast_date as deliveryForecastDate, o.delivered_date as deliveredDate,
        s.name as storeName, os.name as statusName, sc.name as salesChannelName,
      c.name as customerName, o.customer_id as customerId,
        ${moneyFields.orderFinancials}
      from orders o
      join stores s on s.id = o.store_id
      join order_statuses os on os.id = o.status_id
      join sales_channels sc on sc.id = o.sales_channel_id
      left join customers c on c.id = o.customer_id
      join order_financials of on of.order_id = o.id
      where o.id = ?
    `,
    [id]
  );
  if (!order) {
    reply.code(404);
    return { error: "Pedido não encontrado" };
  }
  const items = all(
    `
      select id, product_id as productId, sku, listing_title as listingTitle, quantity,
        sale_unit_price_cents as saleUnitPriceCents, cost_unit_cents as costUnitCents
      from order_items where order_id = ? order by id
    `,
    [id]
  );
  return { ...(order as object), items };
});

app.post("/api/orders", async (request, reply) => {
  const data = orderSchema.parse(request.body);
  const orderId = db.transaction<number>(() => {
    db.prepare(
      "insert into orders (store_id, external_order_id, sale_date, status_id, status_description, sales_channel_id, customer_id, notes, delivery_forecast_date, delivered_date) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      data.storeId,
      data.externalOrderId,
      data.saleDate,
      data.statusId,
      data.statusDescription,
      data.salesChannelId,
      data.customerId ?? null,
      data.notes,
      data.deliveryForecastDate || null,
      data.deliveredDate || null
    );
    db.prepare(
      "insert into order_financials (order_id, products_amount_cents, shipping_total_cents, shipping_customer_cents, platform_fee_cents, discount_cents, other_costs_cents, amount_received_cents, packaging_cents, additional_costs_cents) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      TX_ID,
      data.financials.productsAmountCents,
      data.financials.shippingTotalCents,
      data.financials.shippingCustomerCents,
      data.financials.platformFeeCents,
      data.financials.discountCents,
      data.financials.otherCostsCents,
      data.financials.amountReceivedCents,
      data.financials.packagingCents,
      data.financials.additionalCostsCents
    );
    const itemStmt = db.prepare(
      "insert into order_items (order_id, product_id, sku, listing_title, quantity, sale_unit_price_cents, cost_unit_cents) values (?, ?, ?, ?, ?, ?, ?)"
    );
    data.items.forEach((item) =>
      itemStmt.run(
        TX_ID,
        item.productId ?? null,
        item.sku,
        item.listingTitle,
        item.quantity,
        item.saleUnitPriceCents,
        item.costUnitCents
      )
    );
    return TX_ID as unknown as number;
  });
  db.log("create", "order", orderId, `Pedido #${orderId} criado`);
  reply.code(201);
  return { id: orderId };
});

app.put("/api/orders/:id", async (request, reply) => {
  const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
  const data = orderSchema.parse(request.body);
  const existing = get("select id from orders where id = ?", [id]);
  if (!existing) {
    reply.code(404);
    return { error: "Pedido não encontrado" };
  }
  if (data.externalOrderId) {
    const dup = get("select id from orders where store_id = ? and sales_channel_id = ? and external_order_id = ? and id != ?", [data.storeId, data.salesChannelId, data.externalOrderId, id]);
    if (dup) {
      reply.code(409);
      return { error: "externalOrderId já usado por outro pedido" };
    }
  }
  db.transaction(() => {
    db.prepare(
      `update orders set
        store_id = ?, external_order_id = ?, sale_date = ?,
        status_id = ?, status_description = ?, sales_channel_id = ?,
        customer_id = ?, notes = ?, delivery_forecast_date = ?, delivered_date = ?, updated_at = current_timestamp
       where id = ?`
    ).run(
      data.storeId, data.externalOrderId, data.saleDate,
      data.statusId, data.statusDescription, data.salesChannelId,
      data.customerId ?? null, data.notes, data.deliveryForecastDate || null, data.deliveredDate || null, id
    );
    db.prepare(
      `update order_financials set
        products_amount_cents = ?, shipping_total_cents = ?,
        shipping_customer_cents = ?, platform_fee_cents = ?,
        discount_cents = ?, other_costs_cents = ?, amount_received_cents = ?,
        packaging_cents = ?, additional_costs_cents = ?
       where order_id = ?`
    ).run(
      data.financials.productsAmountCents,
      data.financials.shippingTotalCents,
      data.financials.shippingCustomerCents,
      data.financials.platformFeeCents,
      data.financials.discountCents,
      data.financials.otherCostsCents,
      data.financials.amountReceivedCents,
      data.financials.packagingCents,
      data.financials.additionalCostsCents,
      id
    );
    db.prepare("delete from order_items where order_id = ?").run(id);
    const itemStmt = db.prepare(
      "insert into order_items (order_id, product_id, sku, listing_title, quantity, sale_unit_price_cents, cost_unit_cents) values (?, ?, ?, ?, ?, ?, ?)"
    );
    data.items.forEach((item) =>
      itemStmt.run(id, item.productId ?? null, item.sku, item.listingTitle, item.quantity, item.saleUnitPriceCents, item.costUnitCents)
    );
  });
  db.log("update", "order", id, `Pedido #${id} atualizado`);
  reply.code(200);
  return { id };
});

app.get("/api/status-transitions", () => {
  const statuses = db.prepare("select id, name from order_statuses where active = 1 order by sort_order").all([]) as { id: number; name: string }[];
  const transitions: Record<number, { id: number; name: string }[]> = {};
  for (const s of statuses) {
    const name = s.name.toLowerCase();
    const allowedNames = (STATUS_TRANSITIONS as Record<string, string[]>)[name];
    if (allowedNames) {
      transitions[s.id] = allowedNames.map(n => ({ id: getStatusId(n), name: getStatusName(getStatusId(n)) }));
    } else {
      transitions[s.id] = [];
    }
  }
  return transitions;
});

app.put("/api/orders/:id/status", async (request, reply) => {
  const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
  const { statusId } = z.object({ statusId: z.coerce.number().int().positive() }).parse(request.body);
  const order = get("select status_id, sales_channel_id from orders where id = ?", [id]);
  if (!order) {
    reply.code(404);
    return { error: "Pedido não encontrado" };
  }
  const currentId = (order as any).status_id;
  const allowed = resolveTransitions(currentId);
  if (!allowed.includes(statusId)) {
    reply.code(400);
    return { error: "Transição de status inválida" };
  }
  const newStatus = get("select name from order_statuses where id = ?", [statusId]) as any;
  db.prepare("update orders set status_id = ?, updated_at = current_timestamp where id = ?").run(statusId, id);

  /* Auto-estorno para Mercado Livre ao marcar como Devolvido */
  if (isDevolvido(statusId)) {
    const channel = get("select name from sales_channels where id = ?", [(order as any).sales_channel_id]) as any;
    if (channel?.name === "Mercado Livre") {
      db.prepare(`update order_financials set
        products_amount_cents = 0,
        shipping_total_cents = 0,
        shipping_customer_cents = 0,
        platform_fee_cents = 0,
        discount_cents = 0,
        other_costs_cents = 0,
        amount_received_cents = 0,
        packaging_cents = 0,
        additional_costs_cents = 0
      where order_id = ?`).run(id);
      db.prepare("update order_items set cost_unit_cents = 0 where order_id = ?").run(id);
      db.log("status", "order", id, `Pedido #${id} → "Devolvido" (ML) — valores estornados`);
      return { ok: true };
    }
  }

  db.log("status", "order", id, `Pedido #${id} → "${newStatus?.name ?? statusId}"`);
  return { ok: true };
});

app.delete("/api/orders/:id", async (request) => {
  const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
  db.prepare("delete from order_items where order_id = ?").run(id);
  db.prepare("delete from orders where id = ?").run(id);
  db.log("delete", "order", id, `Pedido #${id} excluído`);
  return { ok: true };
});

app.post("/api/orders/bulk-delete", async (request) => {
  const { ids } = z.object({ ids: z.array(z.number().int().positive()).nonempty() }).parse(request.body);
  for (const id of ids) {
    db.prepare("delete from order_items where order_id = ?").run(id);
    db.prepare("delete from orders where id = ?").run(id);
    db.log("delete", "order", id, `Pedido #${id} excluído (em lote)`);
  }
  return { ok: true, deleted: ids.length };
});

function getDefaultGroupBy(startDate: string, endDate: string): "day" | "week" | "month" {
  const days = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24));
  if (days > 90) return "month";
  if (days > 30) return "week";
  return "day";
}

function dashboardTotals(conditions: string[], params: unknown[]) {
  const filters = [`o.status_id != ${getStatusId("devolvido")}`, ...conditions];
  const where = filters.length ? "where " + filters.join(" and ") : "";
  const rows = all(
    `select
      o.id, o.sale_date as saleDate, o.store_id as storeId, s.name as storeName, sc.name as channelName,
      of.products_amount_cents as productsAmountCents,
      of.shipping_total_cents as shippingTotalCents,
      of.shipping_customer_cents as shippingCustomerCents,
      of.platform_fee_cents as platformFeeCents,
      of.discount_cents as discountCents,
      of.other_costs_cents as otherCostsCents,
      of.amount_received_cents as amountReceivedCents,
      of.packaging_cents as packagingCents,
      of.additional_costs_cents as additionalCostsCents,
      coalesce(sum(oi.quantity * oi.cost_unit_cents), 0) as itemsCostCents,
      coalesce(sum(oi.quantity), 0) as totalItems
    from orders o
    join stores s on s.id = o.store_id
    join sales_channels sc on sc.id = o.sales_channel_id
    join order_financials of on of.order_id = o.id
    left join order_items oi on oi.order_id = o.id
    ${where}
    group by o.id`,
    params
  ) as any[];
  const totals = rows.reduce(
    (acc, row) => {
      const calc = calculateOrderTotals(row);
      acc.orderCount += 1;
      acc.grossRevenueCents += calc.grossRevenueCents;
      acc.netRevenueCents += calc.netRevenueCents;
      acc.saleResultCents += calc.saleResultCents;
      acc.profitCents += calc.profitCents;
      acc.itemsCostCents += calc.itemsCostCents;
      acc.shippingCustomerCents += row.shippingCustomerCents;
      acc.shippingSubsidyCents += calc.shippingSubsidyCents;
      acc.totalItems += row.totalItems;
      acc.marginPercent = acc.grossRevenueCents ? (acc.profitCents / acc.grossRevenueCents) * 100 : 0;
      acc.totalCostCents = acc.itemsCostCents + (acc.grossRevenueCents - acc.netRevenueCents);
      acc.avgTicketCents = acc.orderCount ? Math.round(acc.grossRevenueCents / acc.orderCount) : 0;
      return acc;
    },
    { orderCount: 0, grossRevenueCents: 0, netRevenueCents: 0, saleResultCents: 0, profitCents: 0, itemsCostCents: 0, shippingCustomerCents: 0, shippingSubsidyCents: 0, totalItems: 0, totalCostCents: 0, avgTicketCents: 0, marginPercent: 0 }
  );
  return { rows, totals };
}

app.get("/api/dashboard", (request) => {
  const query = request.query as Record<string, unknown>;
  const startDate = query.startDate ? String(query.startDate) : null;
  const endDate = query.endDate ? String(query.endDate) : null;
  const storeId = query.storeId ? Number(query.storeId) : null;
  const allTime = query.allTime === "true";

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (!allTime) {
    if (startDate) {
      conditions.push("date(o.sale_date) >= date(?)");
      params.push(startDate);
    } else {
      conditions.push("date(o.sale_date) >= date('now', 'start of month')");
    }
    if (endDate) {
      conditions.push("date(o.sale_date) <= date(?)");
      params.push(endDate);
    }
  }
  if (storeId) {
    conditions.push("o.store_id = ?");
    params.push(storeId);
  }

  const dashboardConditions = [`o.status_id != ${getStatusId("devolvido")}`, ...conditions];
  const whereClause = dashboardConditions.length ? "where " + dashboardConditions.join(" and ") : "";

  const { rows: orderRows, totals } = dashboardTotals(conditions, params);

  let previousTotals = null;
  if (!allTime && startDate && endDate) {
    const days = Math.round(
      (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (days > 0) {
      const prevStart = new Date(new Date(startDate).getTime() - days * 24 * 60 * 60 * 1000)
        .toISOString().split("T")[0];
      const prevEnd = new Date(new Date(endDate).getTime() - days * 24 * 60 * 60 * 1000)
        .toISOString().split("T")[0];
      const prevConditions: string[] = [
        "date(o.sale_date) >= date(?)",
        "date(o.sale_date) <= date(?)"
      ];
      const prevParams: unknown[] = [prevStart, prevEnd];
      if (storeId) {
        prevConditions.push("o.store_id = ?");
        prevParams.push(storeId);
      }
      previousTotals = dashboardTotals(prevConditions, prevParams).totals;
    }
  }

  const productRows = all(
    `select
      coalesce(p.name, oi.listing_title, oi.sku, 'Sem produto') as name,
      sum(oi.quantity) as quantity,
      sum(oi.quantity * oi.sale_unit_price_cents) as revenueCents,
      sum(oi.quantity * (oi.sale_unit_price_cents - oi.cost_unit_cents)) as profitCents
    from order_items oi
    join orders o on o.id = oi.order_id
    left join products p on p.id = oi.product_id
    ${whereClause}
    group by name
    order by quantity desc
    limit 8`,
    params
  );

  const channelRows = orderRows.reduce<Record<string, any>>((acc, row) => {
    const calc = calculateOrderTotals(row);
    const item = acc[row.channelName] ?? { name: row.channelName, orderCount: 0, grossRevenueCents: 0, profitCents: 0 };
    item.orderCount += 1;
    item.grossRevenueCents += calc.grossRevenueCents;
    item.profitCents += calc.profitCents;
    item.marginPercent = item.grossRevenueCents ? (item.profitCents / item.grossRevenueCents) * 100 : 0;
    acc[row.channelName] = item;
    return acc;
  }, {});

  const storeRows = orderRows.reduce<Record<string, any>>((acc, row) => {
    const calc = calculateOrderTotals(row);
    const item = acc[row.storeName] ?? { name: row.storeName, grossRevenueCents: 0, profitCents: 0 };
    item.grossRevenueCents += calc.grossRevenueCents;
    item.profitCents += calc.profitCents;
    acc[row.storeName] = item;
    return acc;
  }, {});

  const groupBy = (query.groupBy ? String(query.groupBy) : (endDate && startDate ? getDefaultGroupBy(startDate, endDate) : "day")) as "day" | "week" | "month";

  const timeSeriesRows = orderRows.reduce<Record<string, { period: string; revenueCents: number; profitCents: number; costsCents: number; orderCount: number }>>((acc, row) => {
    const calc = calculateOrderTotals(row);
    let period: string;
    if (groupBy === "week") {
      const d = new Date(row.saleDate + "T12:00:00");
      const dayNum = d.getDay() || 7;
      d.setDate(d.getDate() + 4 - dayNum);
      const yearStart = new Date(d.getFullYear(), 0, 1);
      const weekNum = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
      period = `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
    } else if (groupBy === "month") {
      period = String(row.saleDate).slice(0, 7);
    } else {
      period = String(row.saleDate).slice(0, 10);
    }
    const entry = acc[period] ?? { period, revenueCents: 0, profitCents: 0, costsCents: 0, orderCount: 0 };
    entry.revenueCents += calc.grossRevenueCents;
    entry.profitCents += calc.profitCents;
    entry.costsCents += calc.itemsCostCents + (calc.grossRevenueCents - calc.netRevenueCents);
    entry.orderCount += 1;
    acc[period] = entry;
    return acc;
  }, {});

  const timeSeries = Object.values(timeSeriesRows).sort((a, b) => a.period.localeCompare(b.period));

  if (timeSeries.length > 0 && !allTime && startDate && endDate) {
    const periodMap = new Map(timeSeries.map(d => [d.period, d]));
    const current = new Date(startDate + "T12:00:00");
    const end = new Date(endDate + "T12:00:00");
    while (current <= end) {
      let period: string;
      if (groupBy === "week") {
        const dayNum = current.getDay() || 7;
        const thurs = new Date(current);
        thurs.setDate(current.getDate() + 4 - dayNum);
        const yearStart = new Date(thurs.getFullYear(), 0, 1);
        const weekNum = Math.ceil((((thurs.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
        period = `${thurs.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
        current.setDate(current.getDate() + 7);
      } else if (groupBy === "month") {
        period = current.toISOString().slice(0, 7);
        current.setMonth(current.getMonth() + 1);
      } else {
        period = current.toISOString().slice(0, 10);
        current.setDate(current.getDate() + 1);
      }
      if (!periodMap.has(period)) {
        timeSeries.push({ period, revenueCents: 0, profitCents: 0, costsCents: 0, orderCount: 0 });
      }
    }
    timeSeries.sort((a, b) => a.period.localeCompare(b.period));
  }

  const allProductRows = productRows as any[];
  for (const p of allProductRows) {
    const revenue = p.revenueCents || 0;
    p.marginPercent = revenue ? ((p.profitCents || 0) / revenue) * 100 : 0;
  }

  return { totals, previousTotals, products: productRows, channels: Object.values(channelRows), stores: Object.values(storeRows), timeSeries };
});

app.get("/api/todo-board", (request) => {
  const query = request.query as Record<string, unknown>;
  const showDone = query.showDone !== "0";

  const columns = all<{ id: number; name: string; position: number; is_done_column: number }>(
    "select id, name, position, is_done_column from todo_columns where active = 1 order by position, id"
  );

  const allTodos = all<{
    id: number; column_id: number; title: string; notes: string;
    position: number; priority: number; due_date: string; done_at: string;
  }>(
    `select id, column_id, title, notes, position, priority, due_date, done_at
     from todos order by position`
  );

  const board = columns.map((col) => {
    const isDone = col.is_done_column === 1;
    let cards = allTodos.filter((t) => t.column_id === col.id);
    if (isDone && !showDone) {
      cards = [];
    }
    return {
      id: col.id,
      name: col.name,
      isDoneColumn: isDone,
      cards: cards.map((t) => ({
        id: t.id,
        title: t.title,
        notes: t.notes || "",
        priority: t.priority,
        dueDate: t.due_date || null,
        doneAt: t.done_at || null,
        position: t.position,
      })),
    };
  });

  return board;
});

app.post("/api/todo-columns", async (request, reply) => {
  const data = todoColumnSchema.parse(request.body);
  const maxPos = (get("select coalesce(max(position), -1) as m from todo_columns") as any)?.m ?? -1;
  const position = maxPos + 1;
  const result = db.prepare(
    "insert into todo_columns (name, position, is_done_column) values (?, ?, ?)"
  ).run(data.name, position, data.isDoneColumn ? 1 : 0);
  db.log("create", "todo_column", Number(result.lastInsertRowid), `Coluna "${data.name}" criada`);
  reply.code(201);
  return { id: result.lastInsertRowid, position };
});

app.put("/api/todo-columns/:id", async (request, reply) => {
  const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
  const existing = get("select id from todo_columns where id = ?", [id]);
  if (!existing) { reply.code(404); return { error: "Coluna nao encontrada" }; }
  const data = todoColumnSchema.partial().parse(request.body);
  db.prepare(
    "update todo_columns set name = coalesce(?, name), position = coalesce(?, position), is_done_column = coalesce(?, is_done_column) where id = ?"
  ).run(data.name ?? null, data.position ?? null, data.isDoneColumn !== undefined ? (data.isDoneColumn ? 1 : 0) : null, id);
  db.log("update", "todo_column", id, `Coluna atualizada`);
  return { ok: true };
});

app.delete("/api/todo-columns/:id", async (request, reply) => {
  const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
  const cardCount = (get("select count(*) as c from todos where column_id = ?", [id]) as any)?.c ?? 0;
  if (cardCount > 0) {
    reply.code(409);
    return { error: "Nao e possivel excluir coluna com cards existentes." };
  }
  const col = get("select name from todo_columns where id = ?", [id]) as any;
  db.prepare("delete from todo_columns where id = ?").run(id);
  db.log("delete", "todo_column", id, `Coluna "${col?.name ?? "#" + id}" excluida`);
  return { ok: true };
});

app.post("/api/todos", async (request, reply) => {
  const data = todoSchema.parse(request.body);
  const maxPos = (get("select coalesce(max(position), -1) as m from todos where column_id = ?", [data.columnId]) as any)?.m ?? -1;
  const position = maxPos + 1;
  const result = db.prepare(
    "insert into todos (column_id, title, notes, position, priority, due_date) values (?, ?, ?, ?, ?, ?)"
  ).run(data.columnId, data.title, data.notes, position, data.priority, data.dueDate ?? null);
  db.log("create", "todo", Number(result.lastInsertRowid), `Card "${data.title}" criado`);
  reply.code(201);
  return { id: result.lastInsertRowid, position };
});

app.put("/api/todos/:id", async (request, reply) => {
  const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
  const existing = get("select id from todos where id = ?", [id]);
  if (!existing) { reply.code(404); return { error: "Card nao encontrado" }; }
  const data = todoSchema.partial().parse(request.body);
  db.prepare(
    `update todos set
      column_id = coalesce(?, column_id),
      title = coalesce(?, title),
      notes = coalesce(?, notes),
      position = coalesce(?, position),
      priority = coalesce(?, priority),
      due_date = coalesce(?, due_date),
      updated_at = current_timestamp
     where id = ?`
  ).run(
    data.columnId ?? null, data.title ?? null, data.notes ?? null,
    data.position ?? null, data.priority ?? null, data.dueDate ?? null,
    id
  );
  db.log("update", "todo", id, `Card atualizado`);
  return { ok: true };
});

app.put("/api/todos/:id/move", async (request, reply) => {
  const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
  const existing = get("select id from todos where id = ?", [id]);
  if (!existing) { reply.code(404); return { error: "Card nao encontrado" }; }
  const data = todoMoveSchema.parse(request.body);
  const column = get("select is_done_column from todo_columns where id = ?", [data.columnId]) as any;
  const isDone = column?.is_done_column === 1;
  db.prepare(
    "update todos set column_id = ?, position = ?, done_at = ?, updated_at = current_timestamp where id = ?"
  ).run(data.columnId, data.position, isDone ? new Date().toISOString() : null, id);
  db.log("move", "todo", id, isDone ? `Card movido para coluna de concluidos` : `Card movido`);
  return { ok: true };
});

app.delete("/api/todos/:id", async (request) => {
  const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
  const card = get("select title from todos where id = ?", [id]) as any;
  db.prepare("delete from todos where id = ?").run(id);
  db.log("delete", "todo", id, `Card "${card?.title ?? "#" + id}" excluido`);
  return { ok: true };
});

const backupDir = path.resolve("data", "backups");
if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

function backupFilePaths() {
  return fs.readdirSync(backupDir).filter((f) => f.endsWith(".sqlite")).map((f) => {
    const full = path.join(backupDir, f);
    let date = f.replace(/^backup-|\.sqlite$/g, "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    } else if (/^\d{4}-\d{2}-\d{2}T/.test(date)) {
      date = date.slice(0, 10);
    } else {
      date = "";
    }
    return { name: f, full, size: fs.statSync(full).size, date };
  }).filter((f) => f.date).sort((a, b) => b.date.localeCompare(a.date));
}

function pruneBackups() {
  const files = backupFilePaths();
  const now = Date.now();
  const ms30d = 30 * 24 * 60 * 60 * 1000;
  const keep = new Set<string>();
  const monthGroups = new Map<string, { name: string; date: string }[]>();

  for (const f of files) {
    if (!/^backup-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f.name)) {
      fs.unlinkSync(f.full);
      continue;
    }
    const age = now - new Date(f.date + "T00:00:00").getTime();
    if (age <= ms30d) {
      keep.add(f.name);
    } else {
      const month = f.date.slice(0, 7);
      if (!monthGroups.has(month)) monthGroups.set(month, []);
      monthGroups.get(month)!.push(f);
    }
  }

  for (const [, group] of monthGroups) {
    group.sort((a, b) => b.date.localeCompare(a.date));
    keep.add(group[0].name);
  }

  for (const f of files) {
    if (!keep.has(f.name)) fs.unlinkSync(f.full);
  }
}

function runBackup() {
  const now = new Date();
  const stamp = now.toISOString().slice(0, 10);
  const target = path.join(backupDir, `backup-${stamp}.sqlite`);
  db.backup(target);
  pruneBackups();
}

/**
 * Runs a backup only if none exists for today yet.
 */
function maybeBackup() {
  const stamp = new Date().toISOString().slice(0, 10);
  const files = fs.readdirSync(backupDir).filter((f) => f === `backup-${stamp}.sqlite`);
  if (files.length === 0) runBackup();
  pruneBackups();
}

/* ───── Order totals helper (for auto-calc in finance) ───── */

app.get("/api/orders/totals", (request) => {
  const query = request.query as Record<string, unknown>;
  const ids = String(query.ids ?? "").split(",").map(Number).filter((n) => n > 0);
  if (!ids.length) return { amountReceivedCents: 0, grossRevenueCents: 0, orderCount: 0 };
  const placeholders = ids.map(() => "?").join(",");
  const row = get(
    `select
       coalesce(sum(of.amount_received_cents), 0) as amountReceivedCents,
       coalesce(sum(of.products_amount_cents + of.shipping_customer_cents), 0) as grossRevenueCents,
       count(*) as orderCount
     from order_financials of
     where of.order_id in (${placeholders})`,
    ids
  ) as any;
  return row ?? { amountReceivedCents: 0, grossRevenueCents: 0, orderCount: 0 };
});

/* ───── Transactions ───── */

const transactionSchema = z.object({
  date: z.string().min(1),
  type: z.enum(["income", "expense"]),
  category: z.string().min(1),
  description: z.string().default(""),
  amountCents: z.coerce.number().int(),
  costType: z.enum(["fixed", "variable"]).nullable().optional(),
  notes: z.string().nullable().optional(),
  orderIds: z.array(z.coerce.number().int().positive()).default([]),
  account: z.string().nullable().optional(),
  externalTransactionNumber: z.string().nullable().optional(),
});

app.get("/api/transactions", (request) => {
  const query = request.query as Record<string, unknown>;
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (query.startDate) { conditions.push("date(t.date) >= date(?)"); params.push(query.startDate); }
  if (query.endDate) { conditions.push("date(t.date) <= date(?)"); params.push(query.endDate); }
  if (query.type) { conditions.push("t.type = ?"); params.push(query.type); }
  if (query.category) { conditions.push("t.category = ?"); params.push(query.category); }
  if (query.costType) { conditions.push("t.cost_type = ?"); params.push(query.costType); }
  if (query.q) {
    const q = `%${query.q}%`;
    conditions.push(`(
      t.description like ? or t.account like ? or t.external_tx_number like ?
      or exists (select 1 from transaction_orders txo2
        join orders o2 on o2.id = txo2.order_id
        left join customers c2 on c2.id = o2.customer_id
        where txo2.transaction_id = t.id
        and (cast(o2.id as text) like ? or o2.external_order_id like ? or c2.name like ?))
    )`);
    params.push(q, q, q, q, q, q);
  }
  const where = conditions.length ? "where " + conditions.join(" and ") : "";
  const total = (get(`select count(*) as c from transactions t ${where}`, params) as any)?.c ?? 0;
  const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 500);
  const offset = Math.max(Number(query.offset) || 0, 0);
  const data = all(
    `select t.*,
      (select json_group_array(json_object('id', o.id, 'externalOrderId', o.external_order_id, 'customer', c.name))
       from transaction_orders to2
       join orders o on o.id = to2.order_id
       left join customers c on c.id = o.customer_id
       where to2.transaction_id = t.id) as orders
     from transactions t ${where}
     order by t.date desc, t.id desc
     limit ? offset ?`,
    [...params, limit, offset]
  ).map((r: any) => ({
    id: r.id,
    date: r.date,
    type: r.type,
    category: r.category,
    description: r.description,
    amountCents: r.amount_cents,
    costType: r.cost_type,
    notes: r.notes,
    account: r.account,
    externalTransactionNumber: r.external_tx_number,
    orders: r.orders ? JSON.parse(r.orders) : [],
  }));
  return { data, total };
});

app.get("/api/transactions/descriptions", (request) => {
  const q = (request.query as { q?: string }).q ?? "";
  const data = all(
    "select distinct description from transactions where description like ? order by description limit 20",
    [`%${q}%`]
  ).map((r: any) => r.description);
  return { data };
});

app.get("/api/transactions/:id", (request, reply) => {
  const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
  const row = get("select * from transactions where id = ?", [id]) as any;
  if (!row) { reply.code(404); return { error: "Transação não encontrada" }; }
  const orders = all(
    `select o.id, o.external_order_id as externalOrderId, c.name as customer
     from transaction_orders to2
     join orders o on o.id = to2.order_id
     left join customers c on c.id = o.customer_id
     where to2.transaction_id = ?`,
    [id]
  );
  return {
    id: row.id, date: row.date, type: row.type, category: row.category,
    description: row.description, amountCents: row.amount_cents,
    costType: row.cost_type, notes: row.notes, account: row.account,
    externalTransactionNumber: row.external_tx_number, orders,
  };
});

app.post("/api/transactions", async (request, reply) => {
  const data = transactionSchema.parse(request.body);
  if (data.type === "income" && data.category === "Vendas" && data.orderIds.length === 0) {
    reply.code(422); return { error: "Transação de venda precisa ter ao menos um pedido vinculado" };
  }
  const result = db.prepare(
    "insert into transactions (date, type, category, description, amount_cents, cost_type, notes, account, external_tx_number) values (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(data.date, data.type, data.category, data.description, data.amountCents, data.costType ?? null, data.notes ?? null, data.account ?? null, data.externalTransactionNumber ?? null);
  const txId = Number(result.lastInsertRowid);
  if (data.orderIds.length > 0) {
    const stmt = db.prepare("insert or ignore into transaction_orders (transaction_id, order_id) values (?, ?)");
    data.orderIds.forEach((oid) => stmt.run(txId, oid));
  }
  db.log("create", "transaction", txId, `${data.type === "income" ? "Receita" : "Despesa"}: ${data.description}`);
  reply.code(201);
  return { id: txId };
});

app.put("/api/transactions/:id", async (request, reply) => {
  const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
  const existing = get("select id from transactions where id = ?", [id]);
  if (!existing) { reply.code(404); return { error: "Transação não encontrada" }; }
  const data = transactionSchema.parse(request.body);
  if (data.type === "income" && data.category === "Vendas" && data.orderIds.length === 0) {
    reply.code(422); return { error: "Transação de venda precisa ter ao menos um pedido vinculado" };
  }
  db.prepare(
    "update transactions set date = ?, type = ?, category = ?, description = ?, amount_cents = ?, cost_type = ?, notes = ?, account = ?, external_tx_number = ?, updated_at = current_timestamp where id = ?"
  ).run(data.date, data.type, data.category, data.description, data.amountCents, data.costType ?? null, data.notes ?? null, data.account ?? null, data.externalTransactionNumber ?? null, id);
  db.prepare("delete from transaction_orders where transaction_id = ?").run(id);
  if (data.orderIds.length > 0) {
    const stmt = db.prepare("insert or ignore into transaction_orders (transaction_id, order_id) values (?, ?)");
    data.orderIds.forEach((oid) => stmt.run(id, oid));
  }
  db.log("update", "transaction", id, `${data.type === "income" ? "Receita" : "Despesa"}: ${data.description}`);
  return { ok: true };
});

app.delete("/api/transactions/:id", async (request, reply) => {
  const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
  const existing = get("select id from transactions where id = ?", [id]);
  if (!existing) { reply.code(404); return { error: "Transação não encontrada" }; }
  db.prepare("delete from transactions where id = ?").run(id);
  db.log("delete", "transaction", id, `Transação #${id} excluída`);
  return { ok: true };
});

/* ───── Finance categories ───── */

const financeCategorySchema = z.object({
  name: z.string().min(1),
  type: z.enum(["income", "expense"]),
  color: z.string().default("tag-gray"),
});

app.get("/api/finance/categories", () => {
  const data = all("select id, name, type, color from finance_categories order by name");
  return { data };
});

app.post("/api/finance/categories", async (request, reply) => {
  const data = financeCategorySchema.parse(request.body);
  const existing = get("select id from finance_categories where name = ?", [data.name]);
  if (existing) { reply.code(409); return { error: "Categoria já existe" }; }
  const result = db.prepare("insert into finance_categories (name, type, color) values (?, ?, ?)").run(data.name, data.type, data.color);
  reply.code(201);
  return { id: result.lastInsertRowid };
});

app.delete("/api/finance/categories/:id", async (request, reply) => {
  const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
  const existing = get("select id from finance_categories where id = ?", [id]);
  if (!existing) { reply.code(404); return { error: "Categoria não encontrada" }; }
  db.prepare("delete from finance_categories where id = ?").run(id);
  return { ok: true };
});

/* ───── Opening balance ───── */

app.get("/api/finance/opening-balance", () => {
  const row = get("select value from settings where key = 'opening_balance_cents'");
  return { openingBalanceCents: Number(row?.value ?? 520000) };
});

app.put("/api/finance/opening-balance", async (request, reply) => {
  const { openingBalanceCents } = z.object({ openingBalanceCents: z.coerce.number().int().min(0) }).parse(request.body);
  db.prepare("insert or replace into settings (key, value, description) values ('opening_balance_cents', ?, 'Saldo inicial do financeiro (em centavos)')").run(String(openingBalanceCents));
  return { ok: true };
});

/* ───── DRE ───── */

app.get("/api/finance/dre", (request) => {
  const query = request.query as Record<string, unknown>;
  const startDate = query.startDate ? String(query.startDate) : null;
  const endDate = query.endDate ? String(query.endDate) : null;

  const dateCond: string[] = [];
  const dateParams: unknown[] = [];
  if (startDate) { dateCond.push("date(o.sale_date) >= date(?)"); dateParams.push(startDate); }
  if (endDate) { dateCond.push("date(o.sale_date) <= date(?)"); dateParams.push(endDate); }
  const dateWhere = dateCond.length ? "and " + dateCond.join(" and ") : "";

  const orderBase = `
    from orders o
    join order_statuses os on os.id = o.status_id
    join order_financials of on of.order_id = o.id
    left join (select order_id, sum(quantity * cost_unit_cents) as item_cost from order_items group by order_id) oi_sum on oi_sum.order_id = o.id
  `;

  /* Realized: orders Entregue com income transaction */
  const realizedRevenue = (get(`
    select coalesce(sum(tx_sum.income), 0) as revenueCents
    from orders o
    join order_statuses os on os.id = o.status_id
    left join (
      select txo.order_id, sum(tx.amount_cents) as income
      from transaction_orders txo
      join transactions tx on tx.id = txo.transaction_id
      where tx.type = 'income'
      group by txo.order_id
    ) tx_sum on tx_sum.order_id = o.id
    where os.name = 'Entregue' ${dateWhere}
    and tx_sum.income is not null
  `, dateParams) as any)?.revenueCents ?? 0;

  const realizedCosts = (get(`
    select
      coalesce(sum(oi_sum.item_cost), 0) as itemsCostCents,
      coalesce(sum(of.packaging_cents), 0) as packagingCents,
      coalesce(sum(of.additional_costs_cents + of.other_costs_cents), 0) as additionalCostsCents,
      count(*) as orderCount
    ${orderBase}
    where os.name = 'Entregue' ${dateWhere}
    and exists (select 1 from transaction_orders txo join transactions tx on tx.id = txo.transaction_id where txo.order_id = o.id and tx.type = 'income')
  `, dateParams) as any) ?? {};

  const realized = {
    revenueCents: realizedRevenue,
    itemsCostCents: realizedCosts.itemsCostCents ?? 0,
    packagingCents: realizedCosts.packagingCents ?? 0,
    additionalCostsCents: realizedCosts.additionalCostsCents ?? 0,
    orderCount: realizedCosts.orderCount ?? 0,
  };

  /* Pending: orders Entregue SEM income transaction → estimado via order_financials */
  const pending = (get(`
    select
      coalesce(sum(of.products_amount_cents + of.shipping_customer_cents - of.shipping_total_cents - of.platform_fee_cents - of.other_costs_cents + of.discount_cents), 0) as revenueCents,
      coalesce(sum(oi_sum.item_cost), 0) as itemsCostCents,
      coalesce(sum(of.packaging_cents), 0) as packagingCents,
      coalesce(sum(of.additional_costs_cents + of.other_costs_cents), 0) as additionalCostsCents,
      count(*) as orderCount
    ${orderBase}
    where os.name = 'Entregue' ${dateWhere}
    and not exists (select 1 from transaction_orders txo join transactions tx on tx.id = txo.transaction_id where txo.order_id = o.id and tx.type = 'income')
  `, dateParams) as any) ?? {};

  /* Warnings: transações Vendas sem pedido vinculado */
  const orphanCond: string[] = ["t.type = 'income'", "t.category = 'Vendas'", "not exists (select 1 from transaction_orders txo where txo.transaction_id = t.id)"];
  const orphanParams: unknown[] = [];
  if (startDate) { orphanCond.push("date(t.date) >= date(?)"); orphanParams.push(startDate); }
  if (endDate) { orphanCond.push("date(t.date) <= date(?)"); orphanParams.push(endDate); }
  const transactionsWithoutOrders = (db.prepare(`
    select t.id, t.date, t.description, t.amount_cents
    from transactions t
    where ${orphanCond.join(" and ")}
  `).all(orphanParams) as any[]) ?? [];

  /* Warnings: discrepância entre recebido e esperado por pedido */
  const discrepantRows = (db.prepare(`
    select
      o.id as orderId,
      coalesce(o.external_order_id, '') as externalId,
      coalesce(tx_sum.net, 0) as receivedCents,
      (of.products_amount_cents + of.shipping_customer_cents - of.shipping_total_cents - of.platform_fee_cents - of.other_costs_cents + of.discount_cents) as expectedCents
    from orders o
    join order_statuses os on os.id = o.status_id
    join order_financials of on of.order_id = o.id
    left join (
      select txo.order_id, sum(case when tx.type = 'expense' then -tx.amount_cents else tx.amount_cents end) as net
      from transaction_orders txo
      join transactions tx on tx.id = txo.transaction_id
      group by txo.order_id
    ) tx_sum on tx_sum.order_id = o.id
    where os.name = 'Entregue'
  `).all() as any[]) ?? [];

  const warnings: { orderId: number; externalId: string; receivedCents: number; expectedCents: number; diffCents: number }[] = [];
  for (const r of discrepantRows) {
    const diff = r.receivedCents - r.expectedCents;
    const threshold = Math.max(100, Math.abs(r.expectedCents) * 0.05);
    if (Math.abs(diff) > threshold) {
      warnings.push({
        orderId: r.orderId,
        externalId: r.externalId,
        receivedCents: r.receivedCents,
        expectedCents: r.expectedCents,
        diffCents: diff,
      });
    }
  }

  /* Transaction summaries */
  function txSummary(type: string, costType?: string, excludeCategory?: string, includeUnlinkedOfCategory?: string) {
    const conditions = ["t.type = ?"];
    const params: unknown[] = [type];
    if (costType) { conditions.push("t.cost_type = ?"); params.push(costType); }
    if (excludeCategory && !includeUnlinkedOfCategory) {
      conditions.push("t.category != ?"); params.push(excludeCategory);
    } else if (excludeCategory && includeUnlinkedOfCategory) {
      conditions.push(`(t.category != ? or not exists (select 1 from transaction_orders txo where txo.transaction_id = t.id))`);
      params.push(excludeCategory);
    }
    if (startDate) { conditions.push("date(t.date) >= date(?)"); params.push(startDate); }
    if (endDate) { conditions.push("date(t.date) <= date(?)"); params.push(endDate); }
    const row = get(
      `select coalesce(sum(t.amount_cents), 0) as total, count(*) as count
       from transactions t where ${conditions.join(" and ")}`,
      params
    ) as any;
    return { total: row?.total ?? 0, count: row?.count ?? 0 };
  }

  return {
    orders: { realized, pending },
    transactions: {
      variableExpenses: txSummary("expense", "variable"),
      fixedExpenses: txSummary("expense", "fixed"),
      otherIncome: txSummary("income", undefined, "Vendas", "Vendas"),
    },
    warnings: {
      discrepantOrders: warnings,
      totalDiscrepancyCents: warnings.reduce((s, w) => s + w.diffCents, 0),
      totalDiscrepancyOrders: warnings.length,
      transactionsWithoutOrders,
    },
  };
});

app.get("/api/finance/totals", (request) => {
  const query = request.query as Record<string, unknown>;
  const startDate = query.startDate ? String(query.startDate) : null;
  const endDate = query.endDate ? String(query.endDate) : null;
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (startDate) { conditions.push("date(t.date) >= date(?)"); params.push(startDate); }
  if (endDate) { conditions.push("date(t.date) <= date(?)"); params.push(endDate); }
  const where = conditions.length ? "where " + conditions.join(" and ") : "";
  const row = get(
    `select
       coalesce(sum(case when t.type = 'income' then t.amount_cents else 0 end), 0) as incomeCents,
       coalesce(sum(case when t.type = 'expense' then t.amount_cents else 0 end), 0) as expenseCents
     from transactions t ${where}`,
    params
  ) as any;
  return { incomeCents: row?.incomeCents ?? 0, expenseCents: row?.expenseCents ?? 0 };
});

app.get("/api/import-log", (request) => {
  const query = request.query as Record<string, unknown>;
  const limit = query.limit ? Number(query.limit) : 20;
  const offset = query.offset ? Number(query.offset) : 0;
  const total = (db.prepare("select count(*) as c from import_log").get() as any)?.c ?? 0;
  const data = db.getImportLog(limit, offset);
  return { data, total };
});

app.get("/api/backups", () => {
  const files = backupFilePaths();
  const totalSizeBytes = files.reduce((s, f) => s + f.size, 0);
  return { files: files.slice(0, 60), totalFiles: files.length, totalSizeBytes, latestDate: files[0]?.date ?? null };
});

app.post("/api/backups", () => {
  runBackup();
  const files = backupFilePaths();
  const totalSizeBytes = files.reduce((s, f) => s + f.size, 0);
  return { latestDate: files[0]?.date ?? null, totalFiles: files.length, totalSizeBytes };
});

setInterval(() => maybeBackup(), 60 * 60 * 1000);

app.listen({ port: 3333, host: "127.0.0.1" }).then(() => {
  maybeBackup();
});
