import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { deleteDb } from "./helpers/setup.js";

let db: any, migrate: any;

let _seq = 0;
function createTestData() {
  _seq++;
  const storeId = db.prepare("insert into stores (name) values (?)").run(`Store ${_seq}`).lastInsertRowid;
  const channelId = db.prepare("insert into sales_channels (name) values (?)").run(`Channel ${_seq}`).lastInsertRowid;
  const statusId = db.prepare("insert into order_statuses (name, sort_order) values (?, ?)").run(`Status ${_seq}`, _seq).lastInsertRowid;
  const customerId = db.prepare("insert into customers (name, phone) values (?, ?)").run(`Customer ${_seq}`, "11999999999").lastInsertRowid;
  const productId = db.prepare("insert into products (name, sku, current_cost_cents) values (?, ?, ?)").run(`Product ${_seq}`, `SKU-${_seq}`, 2000).lastInsertRowid;
  return { storeId, channelId, statusId, customerId, productId };
}

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

describe("CRUD stores", () => {
  it("cria loja", () => {
    const r = db.prepare("insert into stores (name) values (?)").run("Loja Teste");
    expect(r.lastInsertRowid).toBeGreaterThan(0);
  });

  it("busca loja por id", () => {
    const r = db.prepare("insert into stores (name) values (?)").run("Loja Busca");
    const row = db.prepare("select id, name from stores where id = ?").get([r.lastInsertRowid]) as any;
    expect(row).toBeDefined();
    expect(row.name).toBe("Loja Busca");
  });

  it("atualiza loja", () => {
    const r = db.prepare("insert into stores (name) values (?)").run("Loja Antiga");
    db.prepare("update stores set name = ? where id = ?").run("Loja Nova", r.lastInsertRowid);
    const row = db.prepare("select name from stores where id = ?").get([r.lastInsertRowid]) as any;
    expect(row.name).toBe("Loja Nova");
  });

  it("exclui loja", () => {
    const r = db.prepare("insert into stores (name) values (?)").run("Loja Deletar");
    db.prepare("delete from stores where id = ?").run(r.lastInsertRowid);
    const row = db.prepare("select id from stores where id = ?").get([r.lastInsertRowid]);
    expect(row).toBeUndefined();
  });
});

describe("CRUD customers", () => {
  it("cria cliente com todos os campos", () => {
    const r = db.prepare(
      "insert into customers (name, document, phone, email, cidade) values (?, ?, ?, ?, ?)"
    ).run("Fulano", "123.456.789-00", "11988888888", "fulano@email.com", "Sao Paulo");
    expect(r.lastInsertRowid).toBeGreaterThan(0);
  });

  it("busca cliente por nome", () => {
    const rows = db.prepare("select name from customers where name like ?").all(["%Fulano%"]) as any[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe("CRUD products", () => {
  it("cria produto", () => {
    const r = db.prepare(
      "insert into products (name, sku, current_cost_cents, weight_grams, print_time_minutes, additional_cost_cents) values (?, ?, ?, ?, ?, ?)"
    ).run("Produto Teste", "SKU-001", 5000, 100, 60, 200);
    expect(r.lastInsertRowid).toBeGreaterThan(0);
  });

  it("atualiza custo do produto", () => {
    const r = db.prepare("insert into products (name, sku, current_cost_cents) values (?, ?, ?)").run("Produto Custo", "SKU-002", 3000);
    db.prepare("update products set current_cost_cents = ? where id = ?").run(4500, r.lastInsertRowid);
    const row = db.prepare("select current_cost_cents from products where id = ?").get([r.lastInsertRowid]) as any;
    expect(row.current_cost_cents).toBe(4500);
  });
});

describe("CRUD orders with items and financials", () => {
  it("cria pedido completo", () => {
    const { storeId, channelId, statusId, customerId, productId } = createTestData();

    const orderId = db.prepare(
      "insert into orders (store_id, sale_date, status_id, sales_channel_id, customer_id, external_order_id) values (?, ?, ?, ?, ?, ?)"
    ).run(storeId, "2024-01-15", statusId, channelId, customerId, "EXT-001").lastInsertRowid;

    db.prepare(
      "insert into order_financials (order_id, products_amount_cents, shipping_total_cents, shipping_customer_cents, platform_fee_cents) values (?, ?, ?, ?, ?)"
    ).run(orderId, 10000, 2000, 1500, 500);

    db.prepare(
      "insert into order_items (order_id, product_id, sku, quantity, sale_unit_price_cents, cost_unit_cents) values (?, ?, ?, ?, ?, ?)"
    ).run(orderId, productId, "TST-001", 2, 5000, 2000);

    const order = db.prepare("select id, external_order_id, sale_date from orders where id = ?").get([orderId]) as any;
    expect(order.external_order_id).toBe("EXT-001");
    expect(order.sale_date).toBe("2024-01-15");
  });

  it("cria pedido sem customer (opcional)", () => {
    const { storeId, channelId, statusId } = createTestData();
    const orderId = db.prepare(
      "insert into orders (store_id, sale_date, status_id, sales_channel_id) values (?, ?, ?, ?)"
    ).run(storeId, "2024-02-01", statusId, channelId).lastInsertRowid;

    const row = db.prepare("select id from orders where id = ?").get([orderId]) as any;
    expect(row).toBeDefined();
  });
});

describe("CRUD kanban", () => {
  it("cria coluna", () => {
    const r = db.prepare("insert into todo_columns (name, position) values (?, ?)").run("Test Column", 10);
    expect(r.lastInsertRowid).toBeGreaterThan(0);
  });

  it("cria card em coluna", () => {
    const colId = db.prepare("insert into todo_columns (name, position) values (?, ?)").run("Card Column", 20).lastInsertRowid;
    const r = db.prepare("insert into todos (column_id, title, priority) values (?, ?, ?)").run(colId, "Test Card", 1);
    expect(r.lastInsertRowid).toBeGreaterThan(0);
  });

  it("move card entre colunas", () => {
    const colA = db.prepare("insert into todo_columns (name, position) values (?, ?)").run("Column A", 30).lastInsertRowid;
    const colB = db.prepare("insert into todo_columns (name, position) values (?, ?)").run("Column B", 31).lastInsertRowid;
    const cardId = db.prepare("insert into todos (column_id, title) values (?, ?)").run(colA, "Movable Card").lastInsertRowid;

    db.prepare("update todos set column_id = ?, position = ? where id = ?").run(colB, 0, cardId);
    const card = db.prepare("select column_id from todos where id = ?").get([cardId]) as any;
    expect(card.column_id).toBe(colB);
  });

  it("seta done_at ao mover para coluna de concluidos", () => {
    const colA = db.prepare("insert into todo_columns (name, position, is_done_column) values (?, ?, ?)").run("To Do", 40, 0).lastInsertRowid;
    const doneCol = db.prepare("insert into todo_columns (name, position, is_done_column) values (?, ?, ?)").run("Done", 41, 1).lastInsertRowid;
    const cardId = db.prepare("insert into todos (column_id, title) values (?, ?)").run(colA, "Finish Card").lastInsertRowid;

    db.prepare("update todos set column_id = ?, done_at = ? where id = ?").run(doneCol, new Date().toISOString(), cardId);
    const card = db.prepare("select done_at from todos where id = ?").get([cardId]) as any;
    expect(card.done_at).not.toBeNull();
  });
});
