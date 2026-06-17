import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, moneyFields } from "../db.js";
import { all, get, boolRow, cents } from "./helpers.js";

export default function registerProductRoutes(app: FastifyInstance) {
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
}
