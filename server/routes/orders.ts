import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, moneyFields, TX_ID } from "../db.js";
import { calculateOrderTotals } from "../calculations.js";
import { STATUS_TRANSITIONS, getStatusId, isDevolvido, isValidStatusId, resolveTransitions, getStatusName } from "../statusConfig.js";
import { zeroFinancialsSetClause } from "../financials.js";
import { all, get, cents, optionalId } from "./helpers.js";

export default function registerOrderRoutes(app: FastifyInstance) {
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

  /** GET /api/orders — lista paginada/filtrada de pedidos. Suporta filtros:
   *  customerId, storeId, channelId, statusId, from, to, search, sort, dir, page, pageSize. */
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

  /** GET /api/orders/:id — pedido + itens + valores calculados. */
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

  /** POST /api/orders — cria pedido manual. Aplica "Devolvido zera" se statusId
   *  inicial já for Devolvido (caso raro; normalmente entram como "Novo"). */
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

  /** PUT /api/orders/:id — edição manual de pedido. Não mexe em itens aqui
   *  (use DELETE + POST para re-criar, ou endpoints específicos de itens). */
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

  /** GET /api/status-transitions — mapeamento de transições válidas (id → ids
   *  permitidos), derivado de `statusConfig.ts`. Usado pela UI para habilitar
   *  botões de mudança de status. */
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

  /** PUT /api/orders/:id/status — troca de status. Aplica "Devolvido zera" via
   *  `zeroFinancialsSetClause()` quando o novo status for Devolvido. Esta é
   *  a 3ª peça da regra centralizada em `server/financials.ts` (junto com
   *  `importer.ts` insert/update e `importerMp.ts` estornos). */
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

    if (isDevolvido(statusId)) {
      const channel = get("select name from sales_channels where id = ?", [(order as any).sales_channel_id]) as any;
      if (channel?.name === "Mercado Livre") {
        db.prepare(`update order_financials set ${zeroFinancialsSetClause()} where order_id = ?`).run(id);
        db.prepare("update order_items set cost_unit_cents = 0 where order_id = ?").run(id);
        db.log("status", "order", id, `Pedido #${id} → "Devolvido" (ML) — valores estornados`);
        return { ok: true };
      }
    }

    db.log("status", "order", id, `Pedido #${id} → "${newStatus?.name ?? statusId}"`);
    return { ok: true };
  });

  /** DELETE /api/orders/:id — exclusão física. Cascata remove `order_financials`
   *  e `order_items` (definido no schema). */
  app.delete("/api/orders/:id", async (request) => {
    const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
    db.prepare("delete from order_items where order_id = ?").run(id);
    db.prepare("delete from orders where id = ?").run(id);
    db.log("delete", "order", id, `Pedido #${id} excluído`);
    return { ok: true };
  });

  /** POST /api/orders/bulk-delete — exclusão em lote. Recebe `{ ids: number[] }`. */
  app.post("/api/orders/bulk-delete", async (request) => {
    const { ids } = z.object({ ids: z.array(z.number().int().positive()).nonempty() }).parse(request.body);
    for (const id of ids) {
      db.prepare("delete from order_items where order_id = ?").run(id);
      db.prepare("delete from orders where id = ?").run(id);
      db.log("delete", "order", id, `Pedido #${id} excluído (em lote)`);
    }
    return { ok: true, deleted: ids.length };
  });

  /** GET /api/orders/totals — soma de produtos/frete/custo no período,
   *  considerando os mesmos filtros de `/api/orders`. Usado pelos KPIs. */
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
}
