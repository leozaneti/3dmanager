import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { deleteDb } from "./helpers/setup.js";

let db: any, migrate: any;

function seedOrderData() {
  const storeId = db.prepare("insert into stores (name) values (?)").run("Loja Teste Busca").lastInsertRowid;
  const channelId = db.prepare("insert into sales_channels (name) values (?)").run("Canal Teste Busca").lastInsertRowid;
  const statusNovo = db.prepare("insert into order_statuses (name, sort_order) values (?, ?)").run("Busca-Status-Novo", 10).lastInsertRowid;
  const statusProduzindo = db.prepare("insert into order_statuses (name, sort_order) values (?, ?)").run("Busca-Status-Produzindo", 20).lastInsertRowid;
  const customerId = db.prepare("insert into customers (name, document, phone, cidade) values (?, ?, ?, ?)").run("Joao Silva", "123.456.789-00", "11999999999", "Sao Paulo").lastInsertRowid;
  const productId = db.prepare("insert into products (name, sku, current_cost_cents) values (?, ?, ?)").run("Produto X Busca", "SKU-999-BUSCA", 1000).lastInsertRowid;

  const order1 = db.prepare(
    "insert into orders (store_id, sale_date, status_id, sales_channel_id, customer_id, external_order_id, notes, status_description) values (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(storeId, "2024-01-10", statusNovo, channelId, customerId, "EXT-001", "Urgente - cliente ligou", "Aguardando pagamento").lastInsertRowid;

  db.prepare("insert into order_financials (order_id, products_amount_cents) values (?, ?)").run(order1, 10000);
  db.prepare("insert into order_items (order_id, product_id, sku, quantity, sale_unit_price_cents, cost_unit_cents) values (?, ?, ?, ?, ?, ?)").run(order1, productId, "SKU-999-BUSCA", 1, 10000, 1000);

  const order2 = db.prepare(
    "insert into orders (store_id, sale_date, status_id, sales_channel_id, customer_id, notes) values (?, ?, ?, ?, ?, ?)"
  ).run(storeId, "2024-01-11", statusProduzindo, channelId, customerId, "Pedido personalizado").lastInsertRowid;

  db.prepare("insert into order_financials (order_id, products_amount_cents) values (?, ?)").run(order2, 5000);
  db.prepare("insert into order_items (order_id, sku, listing_title, quantity, sale_unit_price_cents, cost_unit_cents) values (?, ?, ?, ?, ?, ?)").run(order2, "CUS-001", "Caneca Personalizada", 3, 1500, 500);

  return { storeId, channelId, statusNovo, statusProduzindo, customerId, productId, order1, order2 };
}

beforeAll(async () => {
  deleteDb();
  const mod = await import("../db.js");
  db = mod.db;
  migrate = mod.migrate;
  migrate();
  seedOrderData();
});

afterAll(() => {
  deleteDb();
});

function searchOrders(term: string) {
  const s = `%${term}%`;
  return db.prepare(`
    select o.id, o.external_order_id, o.notes, o.status_description,
           c.name as customerName, os.name as statusName
    from orders o
    join order_statuses os on os.id = o.status_id
    join stores s on s.id = o.store_id
    join sales_channels sc on sc.id = o.sales_channel_id
    left join customers c on c.id = o.customer_id
    where (
      s.name like ? or os.name like ? or sc.name like ?
      or c.name like ? or c.document like ? or c.cidade like ? or c.phone like ?
      or o.external_order_id like ? or cast(o.id as text) like ?
      or o.status_description like ? or o.notes like ?
      or exists (select 1 from order_items oi where oi.order_id = o.id and (oi.sku like ? or oi.listing_title like ?))
    )
    order by o.id
  `).all([s, s, s, s, s, s, s, s, s, s, s, s, s]) as any[];
}

describe("order search", () => {
  it("busca por external_order_id", () => {
    const results = searchOrders("EXT-001");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].external_order_id).toBe("EXT-001");
  });

  it("busca por notes", () => {
    const results = searchOrders("Urgente");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("busca por status_description", () => {
    const results = searchOrders("Aguardando");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("busca por nome do cliente", () => {
    const results = searchOrders("Joao");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].customerName).toBe("Joao Silva");
  });

  it("busca por SKU", () => {
    const results = searchOrders("SKU-999-BUSCA");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("busca por listing_title", () => {
    const results = searchOrders("Caneca");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("busca por ID numerico", () => {
    const allOrders = db.prepare("select id from orders order by id").all([]) as any[];
    if (allOrders.length > 0) {
      const id = allOrders[0].id;
      const results = searchOrders(String(id));
      expect(results.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("busca sem resultados retorna array vazio", () => {
    const results = searchOrders("___NADA_EXISTE___");
    expect(results.length).toBe(0);
  });

  it("busca case-insensitive", () => {
    const results = searchOrders("urgente");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("busca por documento do cliente", () => {
    const results = searchOrders("123.456.789-00");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("busca por telefone do cliente", () => {
    const results = searchOrders("11999999999");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("busca por cidade do cliente", () => {
    const results = searchOrders("Sao Paulo");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("busca por nome da loja", () => {
    const results = searchOrders("Loja Teste Busca");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("busca por nome do canal", () => {
    const results = searchOrders("Canal Teste Busca");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});
