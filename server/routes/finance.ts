import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";

export default function registerFinanceRoutes(app: FastifyInstance) {
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

  const financeCategorySchema = z.object({
    name: z.string().min(1),
    type: z.enum(["income", "expense"]),
    color: z.string().default("tag-gray"),
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
    const total = (db.prepare(`select count(*) as c from transactions t ${where}`).get(...params) as any)?.c ?? 0;
    const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 500);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const data = db.prepare(
      `select t.*,
        (select json_group_array(json_object('id', o.id, 'externalOrderId', o.external_order_id, 'customer', c.name))
         from transaction_orders to2
         join orders o on o.id = to2.order_id
         left join customers c on c.id = o.customer_id
         where to2.transaction_id = t.id) as orders
       from transactions t ${where}
       order by t.date desc, t.id desc
       limit ? offset ?`
    ).all(...params, limit, offset).map((r: any) => ({
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
    const data = db.prepare(
      "select distinct description from transactions where description like ? order by description limit 20"
    ).all(`%${q}%`).map((r: any) => r.description);
    return { data };
  });

  app.get("/api/transactions/:id", (request, reply) => {
    const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
    const row = db.prepare("select * from transactions where id = ?").get(id) as any;
    if (!row) { reply.code(404); return { error: "Transação não encontrada" }; }
    const orders = db.prepare(
      `select o.id, o.external_order_id as externalOrderId, c.name as customer
       from transaction_orders to2
       join orders o on o.id = to2.order_id
       left join customers c on c.id = o.customer_id
       where to2.transaction_id = ?`
    ).all(id);
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
    const existing = db.prepare("select id from transactions where id = ?").get(id);
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
    const existing = db.prepare("select id from transactions where id = ?").get(id);
    if (!existing) { reply.code(404); return { error: "Transação não encontrada" }; }
    db.prepare("delete from transactions where id = ?").run(id);
    db.log("delete", "transaction", id, `Transação #${id} excluída`);
    return { ok: true };
  });

  app.get("/api/finance/categories", () => {
    const data = db.prepare("select id, name, type, color from finance_categories order by name").all();
    return { data };
  });

  app.post("/api/finance/categories", async (request, reply) => {
    const data = financeCategorySchema.parse(request.body);
    const existing = db.prepare("select id from finance_categories where name = ?").get(data.name);
    if (existing) { reply.code(409); return { error: "Categoria já existe" }; }
    const result = db.prepare("insert into finance_categories (name, type, color) values (?, ?, ?)").run(data.name, data.type, data.color);
    reply.code(201);
    return { id: result.lastInsertRowid };
  });

  app.delete("/api/finance/categories/:id", async (request, reply) => {
    const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
    const existing = db.prepare("select id from finance_categories where id = ?").get(id);
    if (!existing) { reply.code(404); return { error: "Categoria não encontrada" }; }
    db.prepare("delete from finance_categories where id = ?").run(id);
    return { ok: true };
  });

  app.get("/api/finance/opening-balance", () => {
    const row = db.prepare("select value from settings where key = 'opening_balance_cents'").get();
    return { openingBalanceCents: Number(row?.value ?? 520000) };
  });

  app.put("/api/finance/opening-balance", async (request, reply) => {
    const { openingBalanceCents } = z.object({ openingBalanceCents: z.coerce.number().int().min(0) }).parse(request.body);
    db.prepare("insert or replace into settings (key, value, description) values ('opening_balance_cents', ?, 'Saldo inicial do financeiro (em centavos)')").run(String(openingBalanceCents));
    return { ok: true };
  });

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

    const realizedRevenue = (db.prepare(`
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
    `).get(...dateParams) as any)?.revenueCents ?? 0;

    const realizedCosts = (db.prepare(`
      select
        coalesce(sum(oi_sum.item_cost), 0) as itemsCostCents,
        coalesce(sum(of.packaging_cents), 0) as packagingCents,
        coalesce(sum(of.additional_costs_cents + of.other_costs_cents), 0) as additionalCostsCents,
        count(*) as orderCount
      ${orderBase}
      where os.name = 'Entregue' ${dateWhere}
      and exists (select 1 from transaction_orders txo join transactions tx on tx.id = txo.transaction_id where txo.order_id = o.id and tx.type = 'income')
    `).get(...dateParams) as any) ?? {};

    const realized = {
      revenueCents: realizedRevenue,
      itemsCostCents: realizedCosts.itemsCostCents ?? 0,
      packagingCents: realizedCosts.packagingCents ?? 0,
      additionalCostsCents: realizedCosts.additionalCostsCents ?? 0,
      orderCount: realizedCosts.orderCount ?? 0,
    };

    const pending = (db.prepare(`
      select
        coalesce(sum(of.products_amount_cents + of.shipping_customer_cents - of.shipping_total_cents - of.platform_fee_cents - of.other_costs_cents + of.discount_cents), 0) as revenueCents,
        coalesce(sum(oi_sum.item_cost), 0) as itemsCostCents,
        coalesce(sum(of.packaging_cents), 0) as packagingCents,
        coalesce(sum(of.additional_costs_cents + of.other_costs_cents), 0) as additionalCostsCents,
        count(*) as orderCount
      ${orderBase}
      where os.name = 'Entregue' ${dateWhere}
      and not exists (select 1 from transaction_orders txo join transactions tx on tx.id = txo.transaction_id where txo.order_id = o.id and tx.type = 'income')
    `).get(...dateParams) as any) ?? {};

    const orphanCond: string[] = ["t.type = 'income'", "t.category = 'Vendas'", "not exists (select 1 from transaction_orders txo where txo.transaction_id = t.id)"];
    const orphanParams: unknown[] = [];
    if (startDate) { orphanCond.push("date(t.date) >= date(?)"); orphanParams.push(startDate); }
    if (endDate) { orphanCond.push("date(t.date) <= date(?)"); orphanParams.push(endDate); }
    const transactionsWithoutOrders = (db.prepare(`
      select t.id, t.date, t.description, t.amount_cents
      from transactions t
      where ${orphanCond.join(" and ")}
    `).all(...orphanParams) as any[]) ?? [];

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
      const row = db.prepare(
        `select coalesce(sum(t.amount_cents), 0) as total, count(*) as count
         from transactions t where ${conditions.join(" and ")}`
      ).get(...params) as any;
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
    const row = db.prepare(
      `select
         coalesce(sum(case when t.type = 'income' then t.amount_cents else 0 end), 0) as incomeCents,
         coalesce(sum(case when t.type = 'expense' then t.amount_cents else 0 end), 0) as expenseCents
       from transactions t ${where}`
    ).get(...params) as any;
    return { incomeCents: row?.incomeCents ?? 0, expenseCents: row?.expenseCents ?? 0 };
  });
}
