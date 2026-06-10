import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { deleteDb } from "./helpers/setup.js";

let db: any, migrate: any;

function seedDashboardData() {
  const storeA = db.prepare("insert into stores (name) values (?)").run("Dash Loja A").lastInsertRowid;
  const storeB = db.prepare("insert into stores (name) values (?)").run("Dash Loja B").lastInsertRowid;
  const channelML = db.prepare("insert into sales_channels (name) values (?)").run("Dash Mercado Livre").lastInsertRowid;
  const channelShopee = db.prepare("insert into sales_channels (name) values (?)").run("Dash Shopee").lastInsertRowid;
  const statusOk = db.prepare("insert into order_statuses (name, sort_order) values (?, ?)").run("Dash Ok", 1).lastInsertRowid;
  const canceled = db.prepare("insert into order_statuses (name, sort_order, is_final) values (?, ?, ?)").run("Dash Cancelado", 5, 1).lastInsertRowid;

  function makeOrder(storeId: number, channelId: number, date: string, statusId: number, productsCents: number, shippingTotal: number, shippingCustomer: number, platformFee: number, itemsCost: number) {
    const oid = db.prepare("insert into orders (store_id, sale_date, status_id, sales_channel_id) values (?, ?, ?, ?)").run(storeId, date, statusId, channelId).lastInsertRowid;
    db.prepare("insert into order_financials (order_id, products_amount_cents, shipping_total_cents, shipping_customer_cents, platform_fee_cents) values (?, ?, ?, ?, ?)").run(oid, productsCents, shippingTotal, shippingCustomer, platformFee);
    db.prepare("insert into order_items (order_id, sku, quantity, sale_unit_price_cents, cost_unit_cents) values (?, ?, ?, ?, ?)").run(oid, "SKU-D", 1, productsCents, itemsCost);
    return oid;
  }

  makeOrder(storeA, channelML, "2024-01-10", statusOk, 10000, 2000, 1500, 500, 3000);
  makeOrder(storeA, channelML, "2024-01-11", statusOk, 20000, 3000, 2000, 800, 5000);
  makeOrder(storeB, channelShopee, "2024-01-15", statusOk, 15000, 1000, 500, 300, 4000);
  makeOrder(storeA, channelML, "2024-02-05", canceled, 5000, 500, 0, 100, 1000);

  return { storeA, storeB, channelML, channelShopee };
}

beforeAll(async () => {
  deleteDb();
  const mod = await import("../db.js");
  db = mod.db;
  migrate = mod.migrate;
  migrate();
  seedDashboardData();
});

afterAll(() => {
  deleteDb();
});

describe("dashboard queries", () => {
  it("retorna total de pedidos no periodo", () => {
    const row = db.prepare("select count(*) as c from orders where sale_date >= ? and sale_date <= ?").get(["2024-01-01", "2024-01-31"]) as any;
    expect(row.c).toBe(3);
  });

  it("filtra pedidos cancelados", () => {
    const row = db.prepare("select count(*) as c from orders o join order_statuses os on os.id = o.status_id where os.is_final = 1 and sale_date between ? and ?").get(["2024-02-01", "2024-02-29"]) as any;
    expect(row.c).toBe(1);
  });

  it("agrupa receita por loja", () => {
    const rows = db.prepare(`
      select s.name, coalesce(sum(of.products_amount_cents), 0) as revenue
      from orders o
      join stores s on s.id = o.store_id
      join order_financials of on of.order_id = o.id
      group by s.name
      order by s.name
    `).all([]) as any[];
    const lojaA = rows.find((r: any) => r.name === "Dash Loja A");
    expect(lojaA).toBeDefined();
    expect(lojaA.revenue).toBeGreaterThan(0);
  });

  it("agrupa receita por canal", () => {
    const rows = db.prepare(`
      select sc.name, count(*) as orderCount, coalesce(sum(of.products_amount_cents), 0) as revenue
      from orders o
      join sales_channels sc on sc.id = o.sales_channel_id
      join order_financials of on of.order_id = o.id
      group by sc.name
      order by sc.name
    `).all([]) as any[];
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("calcula media por pedido", () => {
    const row = db.prepare(`
      select
        count(*) as orderCount,
        coalesce(sum(of.products_amount_cents), 0) as totalRevenue
      from orders o
      join order_financials of on of.order_id = o.id
      where o.sale_date between ? and ?
    `).get(["2024-01-01", "2024-01-31"]) as any;
    expect(row.orderCount).toBe(3);
    expect(row.totalRevenue).toBe(45000);
  });

  it("retorna produtos mais vendidos por quantidade", () => {
    const rows = db.prepare(`
      select coalesce(p.name, oi.sku, 'Sem produto') as name, sum(oi.quantity) as quantity
      from order_items oi
      join orders o on o.id = oi.order_id
      left join products p on p.id = oi.product_id
      group by name
      order by quantity desc
    `).all([]) as any[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const skuD = rows.find((r: any) => r.name === "SKU-D");
    expect(skuD).toBeDefined();
    expect(skuD.quantity).toBeGreaterThanOrEqual(1);
  });

  it("retorna 0 pedidos em periodo sem dados", () => {
    const row = db.prepare("select count(*) as c from orders where sale_date between ? and ?").get(["2025-01-01", "2025-01-31"]) as any;
    expect(row.c).toBe(0);
  });

  it("retorna receita 0 em periodo sem dados", () => {
    const row = db.prepare(`
      select coalesce(sum(of.products_amount_cents), 0) as total
      from orders o
      join order_financials of on of.order_id = o.id
      where o.sale_date between ? and ?
    `).get(["2025-01-01", "2025-01-31"]) as any;
    expect(row.total).toBe(0);
  });
});
