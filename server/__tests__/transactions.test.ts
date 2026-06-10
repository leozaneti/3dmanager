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

describe("transactions CRUD", () => {
  it("cria transacao de receita", () => {
    const r = db.prepare(
      "insert into transactions (date, type, category, description, amount_cents) values (?, ?, ?, ?, ?)"
    ).run("2024-01-15", "income", "Vendas", "Venda produto X", 50000);
    expect(r.lastInsertRowid).toBeGreaterThan(0);
  });

  it("cria transacao de despesa", () => {
    const r = db.prepare(
      "insert into transactions (date, type, category, description, amount_cents, cost_type) values (?, ?, ?, ?, ?, ?)"
    ).run("2024-01-16", "expense", "Insumos", "Compra de PLA", 10000, "variable");
    expect(r.lastInsertRowid).toBeGreaterThan(0);
  });

  it("cria transacao com account e external_tx_number", () => {
    const r = db.prepare(
      "insert into transactions (date, type, category, description, amount_cents, account, external_tx_number) values (?, ?, ?, ?, ?, ?, ?)"
    ).run("2024-01-17", "income", "Vendas", "Recebimento ML", 30000, "Mercado Pago", "MP-123456");
    expect(r.lastInsertRowid).toBeGreaterThan(0);
    const row = db.prepare("select account, external_tx_number from transactions where id = ?").get([r.lastInsertRowid]) as any;
    expect(row.account).toBe("Mercado Pago");
    expect(row.external_tx_number).toBe("MP-123456");
  });

  it("busca transacao por id", () => {
    const r = db.prepare(
      "insert into transactions (date, type, category, description, amount_cents) values (?, ?, ?, ?, ?)"
    ).run("2024-02-01", "income", "Vendas", "Busca transacao", 2000);
    const row = db.prepare("select id, description from transactions where id = ?").get([r.lastInsertRowid]) as any;
    expect(row.description).toBe("Busca transacao");
  });

  it("atualiza transacao", () => {
    const r = db.prepare(
      "insert into transactions (date, type, category, description, amount_cents) values (?, ?, ?, ?, ?)"
    ).run("2024-02-10", "expense", "Energia", "Conta luz", 15000);
    db.prepare("update transactions set amount_cents = ?, description = ? where id = ?").run(18000, "Conta luz atualizada", r.lastInsertRowid);
    const row = db.prepare("select amount_cents, description from transactions where id = ?").get([r.lastInsertRowid]) as any;
    expect(row.amount_cents).toBe(18000);
    expect(row.description).toBe("Conta luz atualizada");
  });

  it("exclui transacao", () => {
    const r = db.prepare(
      "insert into transactions (date, type, category, description, amount_cents) values (?, ?, ?, ?, ?)"
    ).run("2024-03-01", "expense", "Marketing", "Anuncio", 5000);
    db.prepare("delete from transactions where id = ?").run(r.lastInsertRowid);
    const row = db.prepare("select id from transactions where id = ?").get([r.lastInsertRowid]);
    expect(row).toBeUndefined();
  });
});

describe("transactions search", () => {
  function seedSearchData() {
    const t1 = db.prepare(
      "insert into transactions (date, type, category, description, amount_cents, account, external_tx_number) values (?, ?, ?, ?, ?, ?, ?)"
    ).run("2024-03-05", "income", "Vendas", "Recebimento Shopee", 45000, "Shopee Pay", "SP-789").lastInsertRowid;

    const t2 = db.prepare(
      "insert into transactions (date, type, category, description, amount_cents, account, external_tx_number) values (?, ?, ?, ?, ?, ?, ?)"
    ).run("2024-03-06", "expense", "Insumos", "Resina 3D", 8000, "Conta Corrente", "CC-001").lastInsertRowid;

    const storeId = db.prepare("insert into stores (name) values (?)").run("Tx Search Store").lastInsertRowid;
    const channelId = db.prepare("insert into sales_channels (name) values (?)").run("Tx Search Channel").lastInsertRowid;
    const statusId = db.prepare("insert into order_statuses (name, sort_order) values (?, ?)").run("Tx Search Status", 50).lastInsertRowid;
    const customerId = db.prepare("insert into customers (name) values (?)").run("Tx Search Customer").lastInsertRowid;
    const orderId = db.prepare(
      "insert into orders (store_id, sale_date, status_id, sales_channel_id, customer_id, external_order_id) values (?, ?, ?, ?, ?, ?)"
    ).run(storeId, "2024-03-05", statusId, channelId, customerId, "EXT-TX-001").lastInsertRowid;

    db.prepare("insert into transaction_orders (transaction_id, order_id) values (?, ?)").run(t1, orderId);
    return { t1, t2, orderId };
  }

  it("busca por descricao", () => {
    seedSearchData();
    const q = "%Recebimento%";
    const rows = db.prepare("select description from transactions where description like ?").all([q]) as any[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].description).toContain("Recebimento");
  });

  it("busca por account", () => {
    const q = "%Shopee Pay%";
    const rows = db.prepare("select account from transactions where account like ?").all([q]) as any[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("busca por external_tx_number", () => {
    const q = "%SP-789%";
    const rows = db.prepare("select external_tx_number from transactions where external_tx_number like ?").all([q]) as any[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("busca por external_order_id do pedido vinculado", () => {
    const rows = db.prepare(`
      select t.id from transactions t
      join transaction_orders txo on txo.transaction_id = t.id
      join orders o on o.id = txo.order_id
      where o.external_order_id like ?
    `).all(["%EXT-TX-001%"]) as any[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("busca por nome do cliente do pedido vinculado", () => {
    const rows = db.prepare(`
      select t.id from transactions t
      join transaction_orders txo on txo.transaction_id = t.id
      join orders o on o.id = txo.order_id
      left join customers c on c.id = o.customer_id
      where c.name like ?
    `).all(["%Tx Search Customer%"]) as any[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe("finance categories", () => {
  it("cria categoria", () => {
    const r = db.prepare("insert into finance_categories (name, type, color) values (?, ?, ?)").run("Test Category", "income", "tag-blue");
    expect(r.lastInsertRowid).toBeGreaterThan(0);
  });

  it("busca categorias", () => {
    const rows = db.prepare("select name, type from finance_categories where type = ?").all(["income"]) as any[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("cria transacao com source_id e source_type", () => {
    const r = db.prepare(
      "insert into transactions (date, type, category, description, amount_cents, source_id, source_type) values (?, ?, ?, ?, ?, ?, ?)"
    ).run("2024-04-01", "expense", "Insumos", "Compra com source", 5000, "src_001", "manual");
    expect(r.lastInsertRowid).toBeGreaterThan(0);
    const row = db.prepare("select source_id, source_type from transactions where id = ?").get([r.lastInsertRowid]) as any;
    expect(row.source_id).toBe("src_001");
    expect(row.source_type).toBe("manual");
  });
});

describe("DRE query", () => {
  it("calcula total de receitas", () => {
    const row = db.prepare("select coalesce(sum(amount_cents), 0) as total from transactions where type = 'income'").get([]) as any;
    expect(row.total).toBeGreaterThan(0);
  });

  it("calcula total de despesas", () => {
    const row = db.prepare("select coalesce(sum(amount_cents), 0) as total from transactions where type = 'expense'").get([]) as any;
    expect(row.total).toBeGreaterThan(0);
  });
});
