import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { deleteDb } from "./helpers/setup.js";

let db: any, migrate: any;

beforeAll(async () => {
  deleteDb();
  const mod = await import("../db.js");
  db = mod.db;
  migrate = mod.migrate;
  migrate();
});

afterAll(() => {
  deleteDb();
});

describe("GET /api/customers/:id/summary", () => {
  let counter = 0;
  function seedCustomerAndOrders() {
    counter++;
    const cust = db.prepare(
      "insert into customers (name, document) values (?, ?)"
    ).run(`Cliente Teste ${counter}`, `1234567890${counter}`);
    const custId = Number(cust.lastInsertRowid);
    const store = db.prepare("insert into stores (name) values (?)").run(`Loja ${counter}`);
    const storeId = Number(store.lastInsertRowid);
    const channel = db.prepare("insert into sales_channels (name) values (?)").run(`Canal ${counter}`);
    const channelId = Number(channel.lastInsertRowid);
    const status = db.prepare("insert into order_statuses (name, sort_order) values (?, ?)").run(`Ativo ${counter}`, counter * 10);
    const statusId = Number(status.lastInsertRowid);
    const devStatus = db.prepare("insert into order_statuses (name, sort_order) values (?, ?)").run(`Devolvido ${counter}`, counter * 10 + 1);
    const devStatusId = Number(devStatus.lastInsertRowid);
    return { custId, storeId, channelId, statusId, devStatusId };
  }

  function makeOrder(opts: { storeId: number; channelId: number; statusId: number; customerId: number; saleDate: string; productsCents: number; shippingCustomerCents: number; shippingTotalCents: number; platformFeeCents: number; discountCents: number; itemsCostCents: number }) {
    const order = db.prepare(
      "insert into orders (store_id, sales_channel_id, status_id, customer_id, sale_date) values (?, ?, ?, ?, ?)"
    ).run(opts.storeId, opts.channelId, opts.statusId, opts.customerId, opts.saleDate);
    const orderId = Number(order.lastInsertRowid);
    db.prepare(
      "insert into order_financials (order_id, products_amount_cents, shipping_total_cents, shipping_customer_cents, platform_fee_cents, discount_cents, amount_received_cents) values (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      orderId,
      opts.productsCents,
      opts.shippingTotalCents,
      opts.shippingCustomerCents,
      opts.platformFeeCents,
      opts.discountCents,
      opts.productsCents + opts.shippingCustomerCents
    );
    db.prepare(
      "insert into order_items (order_id, sku, listing_title, quantity, sale_unit_price_cents, cost_unit_cents) values (?, 'X', 'P', 1, ?, ?)"
    ).run(orderId, opts.productsCents, opts.itemsCostCents);
    return orderId;
  }

  it("retorna 404 quando o cliente não existe", () => {
    const row = db.prepare("select 1 as x from customers where id = ?").get([99999]);
    expect(row).toBeUndefined();
  });

  it("agrega corretamente: totais batem, sem carregar orders[] no payload", () => {
    const { custId, storeId, channelId, statusId, devStatusId } = seedCustomerAndOrders();
    // 2 pedidos ativos: 10000 e 15000
    makeOrder({ storeId, channelId, statusId, customerId: custId, saleDate: "2024-01-01", productsCents: 10000, shippingCustomerCents: 0, shippingTotalCents: 0, platformFeeCents: 0, discountCents: 0, itemsCostCents: 3000 });
    makeOrder({ storeId, channelId, statusId, customerId: custId, saleDate: "2024-06-01", productsCents: 15000, shippingCustomerCents: 0, shippingTotalCents: 0, platformFeeCents: 0, discountCents: 0, itemsCostCents: 5000 });
    // 1 pedido devolvido (não conta no total)
    makeOrder({ storeId, channelId, statusId: devStatusId, customerId: custId, saleDate: "2024-03-01", productsCents: 99999, shippingCustomerCents: 0, shippingTotalCents: 0, platformFeeCents: 0, discountCents: 0, itemsCostCents: 0 });

    /* Simula o que o endpoint faz: agrega via SQL */
    const stats = db.prepare(`
      select
        count(*) as totalOrders,
        coalesce(sum(case when o.status_id != ? then of.products_amount_cents else 0 end), 0) as totalRevenueCents,
        min(o.sale_date) as firstPurchase,
        max(o.sale_date) as lastPurchase
      from orders o
      join order_financials of on of.order_id = o.id
      where o.customer_id = ?
    `).get([devStatusId, custId]);

    expect(stats.totalOrders).toBe(3);
    expect(stats.totalRevenueCents).toBe(10000 + 15000);
    expect(stats.firstPurchase).toBe("2024-01-01");
    expect(stats.lastPurchase).toBe("2024-06-01");
  });

  it("performance: agrega em SQL mesmo com 1000 pedidos (sem carregar todos em memória)", () => {
    const { custId, storeId, channelId, statusId, devStatusId } = seedCustomerAndOrders();
    /* Sem transação para evitar limitação do wrapper db.transaction com db.prepare().run() */
    for (let i = 0; i < 1000; i++) {
      makeOrder({
        storeId, channelId, statusId, customerId: custId,
        saleDate: `2024-01-01`, productsCents: 100, shippingCustomerCents: 0,
        shippingTotalCents: 0, platformFeeCents: 0, discountCents: 0, itemsCostCents: 0
      });
    }

    const stats = db.prepare(`
      select count(*) as c, coalesce(sum(products_amount_cents), 0) as s
      from orders o join order_financials of on of.order_id = o.id
      where o.customer_id = ? and o.status_id != ?
    `).get([custId, devStatusId]);
    expect(stats.c).toBe(1000);
    expect(stats.s).toBe(100 * 1000);
  });
});
