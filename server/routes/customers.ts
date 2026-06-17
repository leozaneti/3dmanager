import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { getStateName } from "../brazilianStates.js";
import { getStatusId } from "../statusConfig.js";
import { all, get } from "./helpers.js";

export default function registerCustomerRoutes(app: FastifyInstance) {
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
      const stateName = getStateName(String(query.state));
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

    const stats = get<{
      totalOrders: number;
      totalRevenueCents: number;
      totalProfitCents: number;
      firstPurchase: string | null;
      lastPurchase: string | null;
    }>(
      `
        select
          count(*) as totalOrders,
          coalesce(sum(case when o.status_id != ? then of.products_amount_cents else 0 end), 0) as totalRevenueCents,
          0 as totalProfitCents,
          min(o.sale_date) as firstPurchase,
          max(o.sale_date) as lastPurchase
        from orders o
        join order_financials of on of.order_id = o.id
        where o.customer_id = ?
      `,
      [getStatusId("devolvido"), id]
    ) ?? { totalOrders: 0, totalRevenueCents: 0, totalProfitCents: 0, firstPurchase: null, lastPurchase: null };

    const profitRow = get<{ totalProfitCents: number }>(
      `
        select coalesce(sum(
          of.products_amount_cents + of.shipping_customer_cents
          - of.shipping_total_cents - of.platform_fee_cents
          - of.other_costs_cents + of.discount_cents
          - coalesce(items.total, 0)
          - of.packaging_cents - of.additional_costs_cents
        ), 0) as totalProfitCents
        from orders o
        join order_financials of on of.order_id = o.id
        left join (
          select order_id, sum(quantity * cost_unit_cents) as total
          from order_items group by order_id
        ) items on items.order_id = o.id
        where o.customer_id = ? and o.status_id != ?
      `,
      [id, getStatusId("devolvido")]
    );

    return {
      customer,
      totalOrders: stats.totalOrders,
      totalRevenueCents: stats.totalRevenueCents,
      totalProfitCents: profitRow?.totalProfitCents ?? 0,
      firstPurchase: stats.firstPurchase,
      lastPurchase: stats.lastPurchase,
    };
  });
}
