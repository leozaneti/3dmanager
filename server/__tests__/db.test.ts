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

describe("migrate", () => {
  const ALL_TABLES = [
    "stores", "products", "customers", "sales_channels", "order_statuses",
    "orders", "order_financials", "order_items", "settings",
    "audit_log", "import_log", "todo_columns", "todos",
    "transactions", "transaction_orders", "finance_categories",
  ];

  ALL_TABLES.forEach((table) => {
    it(`cria tabela ${table}`, () => {
      const rows = db.prepare("select name from sqlite_master where type='table' and name=?").all([table]);
      expect(rows.length).toBe(1);
    });
  });
});

describe("seed", () => {
  it("insere loja padrao VINIL3D", () => {
    const store = db.prepare("select name from stores").all() as any[];
    expect(store.some((s: any) => s.name === "VINIL3D")).toBe(true);
  });

  it("insere canais de venda", () => {
    const channels = db.prepare("select name from sales_channels").all() as any[];
    expect(channels.length).toBeGreaterThanOrEqual(5);
  });

  it("insere status de pedido", () => {
    const statuses = db.prepare("select name from order_statuses").all() as any[];
    expect(statuses.length).toBeGreaterThanOrEqual(5);
  });

  it("insere colunas kanban padrao (Backlog, Fazendo, Pronto)", () => {
    const columns = db.prepare("select name from todo_columns order by position").all() as any[];
    expect(columns.map((c: any) => c.name)).toEqual(["Backlog", "Fazendo", "Pronto"]);
  });

  it("nao duplica colunas kanban ao rodar migrate novamente", () => {
    migrate();
    const columns = db.prepare("select count(*) as c from todo_columns").get([]) as any;
    expect(columns.c).toBe(3);
  });

  it("insere categorias financeiras", () => {
    const cats = db.prepare("select name from finance_categories").all() as any[];
    expect(cats.length).toBeGreaterThanOrEqual(8);
  });

  it("insere configuracoes padrao", () => {
    const settings = db.prepare("select key from settings").all() as any[];
    expect(settings.some((s: any) => s.key === "pla_price_per_kg")).toBe(true);
  });
});

describe("addColumnIfMissing", () => {
  it("colunas transactions existem apos migrate", () => {
    const info = db.prepare("pragma table_info(transactions)").all() as any[];
    const names = info.map((c: any) => c.name);
    expect(names).toContain("account");
    expect(names).toContain("external_tx_number");
    expect(names).toContain("source_id");
    expect(names).toContain("source_type");
  });
});

describe("foreign keys", () => {
  it("orders referencia stores, order_statuses, sales_channels e customers", () => {
    const fks = db.prepare("pragma foreign_key_list(orders)").all() as any[];
    const refs = fks.map((fk: any) => fk.table);
    expect(refs).toContain("stores");
    expect(refs).toContain("order_statuses");
    expect(refs).toContain("sales_channels");
    expect(refs).toContain("customers");
  });

  it("order_financials e order_items tem on delete cascade para orders", () => {
    const ofFks = db.prepare("pragma foreign_key_list(order_financials)").all() as any[];
    expect(ofFks.some((fk: any) => fk.table === "orders" && fk.on_delete === "CASCADE")).toBe(true);

    const oiFks = db.prepare("pragma foreign_key_list(order_items)").all() as any[];
    expect(oiFks.some((fk: any) => fk.table === "orders" && fk.on_delete === "CASCADE")).toBe(true);
  });

  it("transaction_orders tem on delete cascade para transactions e orders", () => {
    const fks = db.prepare("pragma foreign_key_list(transaction_orders)").all() as any[];
    const cascadeTables = fks.filter((fk: any) => fk.on_delete === "CASCADE").map((fk: any) => fk.table);
    expect(cascadeTables).toContain("transactions");
    expect(cascadeTables).toContain("orders");
  });
});
