import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const env = process.env.DB_ENV || "dev";
const dataDir = path.resolve("data");
const dbPath = path.join(dataDir, `${env}.sqlite`);

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export function literal(value: unknown) {
  if (value === TX_ID) return "@@TX_ID";
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "0";
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function bind(sql: string, params: unknown[]) {
  let index = 0;
  return sql.replace(/\?/g, () => literal(params[index++]));
}

function sqlite(sql: string, json = false) {
  const args = json ? ["-json", dbPath, sql] : [dbPath, sql];
  let output = "";
  try {
    output = execFileSync("sqlite3", args, { encoding: "utf8" }).trim();
  } catch (error) {
    const maybeOutput = (error as { stdout?: string; status?: number }).stdout;
    if ((error as { status?: number }).status === 0 && maybeOutput !== undefined) {
      output = maybeOutput.trim();
    } else {
      throw error;
    }
  }
  if (!json || output.length === 0) return [];
  return JSON.parse(output) as Record<string, unknown>[];
}

/** Sentinel value — use inside `db.transaction()` in place of `last_insert_rowid()` */
export const TX_ID = Symbol("TX_ID");

let _txCollecting = false;
let _txStatements: string[] = [];
let _batching = false;
let _batchStatements: string[] = [];

export const db = {
  exec(sql: string) {
    sqlite(sql);
  },
  pragma(sql: string) {
    sqlite(`pragma ${sql};`);
  },
  prepare(sql: string) {
    return {
      all(params: unknown[] = []) {
        if (_txCollecting) throw Error("all() not supported inside db.transaction()");
        return sqlite(bind(sql, params), true);
      },
      get(params: unknown[] = []) {
        if (_txCollecting) throw Error("get() not supported inside db.transaction()");
        return sqlite(bind(sql, params), true)[0];
      },
      run(...params: unknown[]) {
        if (_txCollecting) {
          _txStatements.push(bind(sql, params));
          return { lastInsertRowid: 0 };
        }
        const rows = sqlite(`${bind(sql, params)}; select last_insert_rowid() as lastInsertRowid;`, true);
        return { lastInsertRowid: Number(rows[0]?.lastInsertRowid ?? 0) };
      }
    };
  },
  transaction<T>(fn: () => T): T {
    _txCollecting = true;
    _txStatements = [];
    try {
      const result = fn();
      const sqlParts: string[] = ["BEGIN"];
      let firstInsert = true;
      for (let stmt of _txStatements) {
        stmt = stmt.replace(/@@TX_ID/g, "(SELECT val FROM _tx_id)");
        sqlParts.push(stmt);
        if (firstInsert && /^\s*insert\s/i.test(stmt)) {
          sqlParts.push(
            "CREATE TEMP TABLE IF NOT EXISTS _tx_id (val integer);" +
            "DELETE FROM _tx_id;" +
            "INSERT INTO _tx_id SELECT last_insert_rowid();"
          );
          firstInsert = false;
        }
      }
      sqlParts.push("COMMIT");
      sqlParts.push("SELECT ifnull((SELECT val FROM _tx_id), 0) AS id;");
      const combined = sqlParts.join(";\n");
      let rows: Record<string, unknown>[];
      try {
        rows = sqlite(combined, true);
      } catch (e) {
        console.error("TX ERROR:", (e as Error).message);
        console.error("TX SQL:", combined);
        throw e;
      }
      const lastId = rows.length > 0 ? Number((rows[0] as any)?.id ?? 0) : 0;
      if (result === (TX_ID as unknown)) return lastId as unknown as T;
      return result;
    } finally {
      _txCollecting = false;
      _txStatements = [];
    }
  },
  log(action: string, entity: string, entityId: number | null, description: string) {
    db.prepare("insert into audit_log (action, entity, entity_id, description) values (?, ?, ?, ?)").run(action, entity, entityId, description);
  },
  beginBatch() {
    _batching = true;
    _batchStatements = [];
  },
  batch(sql: string) {
    if (!_batching) throw Error("not in batch mode");
    _batchStatements.push(sql);
  },
  commitBatch() {
    if (!_batching) throw Error("not in batch mode");
    _batching = false;
    if (_batchStatements.length === 0) return;
    const full = ["BEGIN", ..._batchStatements, "COMMIT"].join(";\n");
    _batchStatements = [];
    try {
      db.exec(full);
    } catch (e) {
      try { db.exec("ROLLBACK"); } catch {}
      throw e;
    }
  },
  rollbackBatch() {
    _batching = false;
    _batchStatements = [];
  },
  getImportLog(limit = 20, offset = 0) {
    return db.prepare("select * from import_log order by created_at desc limit ? offset ?").all([limit, offset]);
  },
  getAuditLog(limit = 50, offset = 0) {
    return db.prepare("select * from audit_log order by created_at desc limit ? offset ?").all([limit, offset]);
  },
  backup(target: string) {
    execFileSync("sqlite3", [dbPath, `.backup "${target}"`], { encoding: "utf8" });
  }
};

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function addColumnIfMissing(table: string, column: string, def: string) {
  const row = sqlite(`pragma table_info(${table});`, true) as { name: string }[];
  if (!row.find((r) => r.name === column)) {
    sqlite(`alter table ${table} add column ${column} ${def};`);
  }
}

export function migrate() {
  db.exec(`
    create table if not exists stores (
      id integer primary key autoincrement,
      name text not null unique,
      active integer not null default 1,
      created_at text not null default current_timestamp,
      updated_at text not null default current_timestamp
    );

    create table if not exists products (
      id integer primary key autoincrement,
      name text not null,
      sku text not null unique,
      current_cost_cents integer not null default 0,
      active integer not null default 1,
      created_at text not null default current_timestamp,
      updated_at text not null default current_timestamp
    );

    create table if not exists customers (
      id integer primary key autoincrement,
      name text not null,
      phone text,
      email text,
      document text,
      cep text,
      logradouro text,
      numero text,
      complemento text,
      bairro text,
      cidade text,
      estado text,
      notes text,
      created_at text not null default current_timestamp,
      updated_at text not null default current_timestamp
    );

    create table if not exists sales_channels (
      id integer primary key autoincrement,
      name text not null unique,
      active integer not null default 1
    );

    create table if not exists order_statuses (
      id integer primary key autoincrement,
      name text not null unique,
      sort_order integer not null default 0,
      is_final integer not null default 0,
      active integer not null default 1
    );

    create table if not exists orders (
      id integer primary key autoincrement,
      store_id integer not null references stores(id),
      external_order_id text,
      sale_date text not null,
      status_id integer not null references order_statuses(id),
      status_description text,
      sales_channel_id integer not null references sales_channels(id),
      customer_id integer references customers(id),
      notes text,
      created_at text not null default current_timestamp,
      updated_at text not null default current_timestamp
    );

    create unique index if not exists idx_orders_external
      on orders(store_id, sales_channel_id, external_order_id)
      where external_order_id is not null and external_order_id <> '';

    create index if not exists idx_orders_store_date on orders(store_id, sale_date);

    create table if not exists order_financials (
      order_id integer primary key references orders(id) on delete cascade,
      products_amount_cents integer not null default 0,
      shipping_total_cents integer not null default 0,
      shipping_customer_cents integer not null default 0,
      platform_fee_cents integer not null default 0,
      discount_cents integer not null default 0,
      other_costs_cents integer not null default 0,
      amount_received_cents integer not null default 0,
      packaging_cents integer not null default 0,
      additional_costs_cents integer not null default 0
    );

    create table if not exists order_items (
      id integer primary key autoincrement,
      order_id integer not null references orders(id) on delete cascade,
      product_id integer references products(id),
      sku text,
      listing_title text,
      quantity integer not null default 1,
      sale_unit_price_cents integer not null default 0,
      cost_unit_cents integer not null default 0
    );

    create index if not exists idx_order_items_order on order_items(order_id);

    create table if not exists settings (
      key text primary key,
      value text not null,
      description text,
      updated_at text not null default current_timestamp
    );

create table if not exists audit_log (
  id integer primary key autoincrement,
  action text not null,
  entity text not null,
  entity_id integer,
  description text not null,
  created_at text not null default current_timestamp
);

create table if not exists import_log (
  id integer primary key autoincrement,
  file_name text not null,
  total_orders integer not null default 0,
  imported integer not null default 0,
  duplicated integer not null default 0,
  updated integer not null default 0,
  created_customers integer not null default 0,
  reused_customers integer not null default 0,
  updated_customers integer not null default 0,
  imported_items integer not null default 0,
  ignored_items integer not null default 0,
  errors_count integer not null default 0,
  duration_seconds text not null default '0',
  status text not null default 'completed',
  created_at text not null default current_timestamp
);


    create table if not exists todo_columns (
      id integer primary key autoincrement,
      name text not null unique,
      position integer not null default 0,
      is_done_column integer not null default 0,
      active integer not null default 1,
      created_at text not null default current_timestamp
    );

    create table if not exists todos (
      id integer primary key autoincrement,
      column_id integer not null references todo_columns(id) on delete cascade,
      title text not null,
      notes text,
      position integer not null default 0,
      priority integer not null default 0,
      due_date text,
      done_at text,
      created_at text not null default current_timestamp,
      updated_at text not null default current_timestamp
    );

    create index if not exists idx_todos_column_pos on todos(column_id, position);

    create table if not exists transactions (
      id integer primary key autoincrement,
      date text not null,
      type text not null check(type in ('income','expense')),
      category text not null,
      description text not null default '',
      amount_cents integer not null default 0,
      cost_type text check(cost_type in ('fixed','variable')),
      notes text,
      created_at text not null default current_timestamp,
      updated_at text not null default current_timestamp
    );

    create table if not exists transaction_orders (
      transaction_id integer not null references transactions(id) on delete cascade,
      order_id integer not null references orders(id) on delete cascade,
      primary key (transaction_id, order_id)
    );

    create table if not exists finance_categories (
      id integer primary key autoincrement,
      name text not null unique,
      type text not null check(type in ('income','expense')),
      color text not null default 'tag-gray'
    );
  `);

  addColumnIfMissing("products", "weight_grams", "integer not null default 0");
  addColumnIfMissing("products", "print_time_minutes", "integer not null default 0");
  addColumnIfMissing("products", "additional_cost_cents", "integer not null default 0");

  addColumnIfMissing("customers", "cep", "text");
  addColumnIfMissing("customers", "logradouro", "text");
  addColumnIfMissing("customers", "numero", "text");
  addColumnIfMissing("customers", "complemento", "text");
  addColumnIfMissing("customers", "bairro", "text");
  addColumnIfMissing("customers", "cidade", "text");
  addColumnIfMissing("customers", "estado", "text");
  addColumnIfMissing("import_log", "updated", "integer not null default 0");
  addColumnIfMissing("order_financials", "packaging_cents", "integer not null default 0");
  addColumnIfMissing("order_financials", "additional_costs_cents", "integer not null default 0");
    const custCols = sqlite("pragma table_info(customers)", true);
    if (custCols.find((c) => c.name === "source_channel")) {
        sqlite("alter table customers drop column source_channel");
    }
    if (custCols.find((c) => c.name === "active")) {
        sqlite("alter table customers drop column active");
    }
    seed();
  cleanup();
}

function cleanup() {
  const alreadyCleaned = db.prepare("select value from settings where key = 'schema_legacy_cleaned'").get([]);
  if (alreadyCleaned) return;

  db.exec("drop table if exists product_categories");
  db.exec("drop table if exists import_batches");
  db.exec("drop table if exists import_rows");
  db.exec("drop table if exists product_cost_history");

  const productCols = sqlite("pragma table_info(products)", true) as { name: string }[];
  if (productCols.find((c) => c.name === "suggested_price_cents")) {
    sqlite("alter table products drop column suggested_price_cents");
  }

  const orderCols = sqlite("pragma table_info(orders)", true) as { name: string }[];
  if (orderCols.find((c) => c.name === "import_batch_id")) {
    sqlite("alter table orders drop column import_batch_id");
  }

  db.prepare("insert or replace into settings (key, value, description) values ('schema_legacy_cleaned', '1', 'Bandeira: tabelas legadas ja removidas')").run([]);
}

function insertIfMissing(table: string, name: string, extra = "") {
  db.prepare(`insert or ignore into ${table} (name${extra ? `, ${extra}` : ""}) values (?)`).run(name);
}

function seed() {
  insertIfMissing("stores", "VINIL3D");

  ["Mercado Livre", "Shopee", "Instagram", "WhatsApp", "Site"].forEach((name) =>
    insertIfMissing("sales_channels", name)
  );

  const settingsStmt = db.prepare(
    "insert or ignore into settings (key, value, description) values (?, ?, ?)"
  );
  [
    ["pla_price_per_kg", "10000", "Preço do PLA por kg (em centavos)"],
    ["energy_cost_per_hour", "10", "Custo de energia por hora (em centavos)"],
    ["machine_value", "800000", "Valor da impressora (em centavos)"],
    ["machine_lifespan_hours", "3000", "Vida útil da máquina em horas"],
    ["maintenance_factor", "10", "Fator de manutenção (%)"],
    ["error_rate", "10", "Taxa de erro (%)"],
    ["packaging_cost", "0", "Custo de embalagem por pedido (em centavos)"],
    ["opening_balance_cents", "520000", "Saldo inicial do financeiro (em centavos)"]
  ].forEach((row) => settingsStmt.run(...row));

  const statusStmt = db.prepare(
    "insert or ignore into order_statuses (name, sort_order, is_final) values (?, ?, ?)"
  );
  [
    ["Novo", 1, 0],
    ["Produção", 2, 0],
    ["Enviado", 3, 0],
    ["Entregue", 4, 0],
    ["Cancelado", 5, 1],
    ["Devolvido", 6, 1]
  ].forEach((row) => statusStmt.run(...row));

  const columnStmt = db.prepare("insert or ignore into todo_columns (name, position, is_done_column) values (?, ?, ?)");
  [["Backlog", 0, 0], ["Fazendo", 1, 0], ["Pronto", 2, 1]].forEach((row) => columnStmt.run(...row));

  // remove duplicate columns (keep lowest id per name)
  db.exec(`delete from todo_columns where id not in (select min(id) from todo_columns group by name)`);

  const catStmt = db.prepare("insert or ignore into finance_categories (name, type, color) values (?, ?, ?)");
  [
    ["Vendas", "income", "tag-green"],
    ["Estorno/Reembolso", "income", "tag-blue"],
    ["Outras entradas", "income", "tag-gray"],
    ["Impostos", "expense", "tag-red"],
    ["Insumos", "expense", "tag-gold"],
    ["Energia", "expense", "tag-red"],
    ["Marketing", "expense", "tag-blue"],
    ["Outros custos", "expense", "tag-gray"],
  ].forEach((row) => catStmt.run(...row));
}

export const moneyFields = {
  product: `
    p.id, p.name, p.sku, p.active,
    p.current_cost_cents as currentCostCents,
    p.weight_grams as weightGrams,
    p.print_time_minutes as printTimeMinutes,
    p.additional_cost_cents as additionalCostCents
  `,
  orderFinancials: `
    products_amount_cents as productsAmountCents,
    shipping_total_cents as shippingTotalCents,
    shipping_customer_cents as shippingCustomerCents,
    platform_fee_cents as platformFeeCents,
    discount_cents as discountCents,
    other_costs_cents as otherCostsCents,
    amount_received_cents as amountReceivedCents,
    packaging_cents as packagingCents,
    additional_costs_cents as additionalCostsCents
  `
};
