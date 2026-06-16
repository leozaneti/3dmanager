import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deleteDb } from "./helpers/setup.js";

let db: any, migrate: any, parseMercadoLivreXlsx: any, importMercadoLivre: any;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const XLSX_PATH = path.resolve(__dirname, "fixtures", "sample-vendas-ml.xlsx");

beforeAll(async () => {
  deleteDb();
  const dbMod = await import("../db.js");
  db = dbMod.db;
  migrate = dbMod.migrate;
  migrate();

  const xlsxMod = await import("../xlsxParser.js");
  parseMercadoLivreXlsx = xlsxMod.parseMercadoLivreXlsx;

  const impMod = await import("../importer.js");
  importMercadoLivre = impMod.importMercadoLivre;

  const existingStore = db.prepare("select id from stores limit 1").get();
  if (!existingStore) {
    db.prepare("insert into stores (name) values (?)").run("Loja Teste");
  }
});

afterAll(() => {
  deleteDb();
});

describe("E2E import — coluna Entrega", () => {
  it("arquivo XLSX existe e é legível", () => {
    expect(fs.existsSync(XLSX_PATH)).toBe(true);
    const buf = fs.readFileSync(XLSX_PATH);
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("parser extrai orders do XLSX real", () => {
    const buf = fs.readFileSync(XLSX_PATH);
    const { orders } = parseMercadoLivreXlsx(buf);
    console.log("Total de pedidos parseados:", orders.length);
    expect(orders.length).toBeGreaterThan(0);
    for (const o of orders) {
      console.log(`  Pedido ${o.saleNumber}: delivery =`, JSON.stringify(o.delivery));
    }
  });

  it("delivery.sentDate está preenchido para pedidos enviados", () => {
    const buf = fs.readFileSync(XLSX_PATH);
    const { orders } = parseMercadoLivreXlsx(buf);
    const withSent = orders.filter((o: any) => o.delivery?.sentDate);
    console.log("Pedidos com sentDate:", withSent.length);
    for (const o of withSent) {
      console.log(`  ${o.saleNumber}: sentDate=${o.delivery.sentDate} (format ISO esperado)`);
      expect(o.delivery.sentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("delivery.deliveredDate está preenchido para pedidos entregues", () => {
    const buf = fs.readFileSync(XLSX_PATH);
    const { orders } = parseMercadoLivreXlsx(buf);
    const withDelivered = orders.filter((o: any) => o.delivery?.deliveredDate);
    console.log("Pedidos com deliveredDate:", withDelivered.length);
    for (const o of withDelivered) {
      console.log(`  ${o.saleNumber}: deliveredDate=${o.delivery.deliveredDate} (format ISO esperado)`);
      expect(o.delivery.deliveredDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("DB schema tem colunas de entrega", () => {
    const cols = db.prepare("pragma table_info(orders)").all() as any[];
    const colNames = cols.map((c: any) => c.name);
    console.log("Colunas de orders:", colNames);
    expect(colNames).toContain("delivery_forecast_date");
    expect(colNames).toContain("delivered_date");
  });

  it("import novo — salva delivery_forecast_date e delivered_date", async () => {
    const buf = fs.readFileSync(XLSX_PATH);
    const { orders } = parseMercadoLivreXlsx(buf);

    const productMap = new Map<string, number>();
    for (const o of orders) {
      for (const item of o.items) {
        if (item.sku && !productMap.has(item.sku)) {
          try {
            const r = db.prepare("insert into products (name, sku, current_cost_cents) values (?, ?, ?)").run(item.title || item.sku, item.sku, 1000);
            productMap.set(item.sku, Number(r.lastInsertRowid));
          } catch {}
        }
      }
    }

    const result = await importMercadoLivre(orders, "test.xlsx");
    console.log("Resultado do import:", JSON.stringify({
      imported: result.importedOrders,
      updated: result.updatedOrders,
      duplicated: result.duplicatedOrders,
      errors: result.errors.length,
    }));

    const rows = db.prepare("select id, external_order_id, delivery_forecast_date, delivered_date from orders").all() as any[];
    console.log("Pedidos no DB:", rows.length);
    for (const r of rows) {
      console.log(`  ${r.external_order_id}: forecast=${r.delivery_forecast_date}, delivered=${r.delivered_date}`);
    }

    const withForecast = rows.filter((r: any) => r.delivery_forecast_date);
    expect(withForecast.length).toBeGreaterThan(0);
  }, 15_000);

  it("reimport — atualiza delivery_forecast_date e delivered_date", async () => {
    const buf = fs.readFileSync(XLSX_PATH);
    const { orders } = parseMercadoLivreXlsx(buf);

    const result = await importMercadoLivre(orders, "test.xlsx");
    console.log("Resultado do reimport (mesmo arquivo):", JSON.stringify({
      updated: result.updatedOrders,
      duplicated: result.duplicatedOrders,
    }));

    const rows = db.prepare("select id, external_order_id, delivery_forecast_date, delivered_date from orders").all() as any[];
    for (const r of rows) {
      console.log(`  ${r.external_order_id}: forecast=${r.delivery_forecast_date}, delivered=${r.delivered_date}`);
    }

    const withDelivered = rows.filter((r: any) => r.delivered_date);
    console.log("Pedidos com delivered_date no DB após reimport:", withDelivered.length);
    expect(withDelivered.length).toBeGreaterThan(0);
  });

  it("reimport com dados novos — atualiza delivered_date", async () => {
    const buf = fs.readFileSync(XLSX_PATH);
    const { orders } = parseMercadoLivreXlsx(buf);

    const beforeRows = db.prepare("select external_order_id, delivered_date from orders").all() as any[];
    const beforeMap = new Map(beforeRows.map((r: any) => [r.external_order_id, r.delivered_date]));

    const targetOrder = orders.find((o: any) => o.delivery?.deliveredDate);
    expect(targetOrder).toBeDefined();
    console.log(`Pedido alvo: ${targetOrder.saleNumber} com deliveredDate=${targetOrder.delivery.deliveredDate}`);

    const alteredOrders = orders.map((o: any) => {
      if (o.saleNumber === targetOrder.saleNumber) {
        return {
          ...o,
          delivery: { ...o.delivery, deliveredDate: "2026-07-15" },
        };
      }
      return o;
    });

    const result = await importMercadoLivre(alteredOrders, "test-altered.xlsx");
    console.log("Resultado do reimport (com alteração):", JSON.stringify({
      updated: result.updatedOrders,
      duplicated: result.duplicatedOrders,
    }));

    const afterRows = db.prepare("select external_order_id, delivered_date from orders").all() as any[];
    for (const r of afterRows) {
      if (beforeMap.get(r.external_order_id) !== r.delivered_date) {
        console.log(`  ${r.external_order_id}: ${beforeMap.get(r.external_order_id)} → ${r.delivered_date}`);
      }
    }

    const target = afterRows.find((r: any) => r.external_order_id === targetOrder.saleNumber);
    console.log(`Pedido alvo no DB: deliveredDate=${target?.delivered_date}`);
    expect(target?.delivered_date).toBe("2026-07-15");
  });

  it("reimport com forecast novo — atualiza delivery_forecast_date", async () => {
    const allBefore = db.prepare("select external_order_id, delivery_forecast_date, delivered_date from orders order by id").all() as any[];
    console.log(`\n=== DB state antes do teste 8 (${allBefore.length} pedidos) ===`);
    for (const r of allBefore) {
      console.log(`  ${r.external_order_id}: forecast=${r.delivery_forecast_date}, delivered=${r.delivered_date}`);
    }

    const buf = fs.readFileSync(XLSX_PATH);
    const { orders } = parseMercadoLivreXlsx(buf);

    const targetOrder = orders.find((o: any) => o.delivery?.sentDate);
    expect(targetOrder).toBeDefined();
    console.log(`\nPedido alvo: saleNumber=${JSON.stringify(targetOrder.saleNumber)} (type=${typeof targetOrder.saleNumber}, len=${targetOrder.saleNumber.length}) com sentDate=${targetOrder.delivery.sentDate}`);

    const allIds = db.prepare("select external_order_id from orders").all() as any[];
    console.log(`external_order_ids no DB: ${allIds.map((r: any) => JSON.stringify(r.external_order_id)).join(", ")}`);
    console.log(`targetOrder.saleNumber === algum? ${allIds.some((r: any) => r.external_order_id === targetOrder.saleNumber)}`);

    const beforeRow = db.prepare("select delivery_forecast_date from orders where external_order_id = ?").get([targetOrder.saleNumber]) as any;
    console.log(`Antes: beforeRow=${JSON.stringify(beforeRow)}, forecast=${beforeRow?.delivery_forecast_date}`);

    const alteredOrders = orders.map((o: any) => {
      if (o.saleNumber === targetOrder.saleNumber) {
        return {
          ...o,
          delivery: { ...o.delivery, sentDate: "2026-08-20" },
        };
      }
      return o;
    });

    const result = await importMercadoLivre(alteredOrders, "test-altered-forecast.xlsx");
    console.log("Resultado:", JSON.stringify({
      updated: result.updatedOrders,
      duplicated: result.duplicatedOrders,
    }));

    const allAfter = db.prepare("select external_order_id, delivery_forecast_date, delivered_date from orders order by id").all() as any[];
    console.log(`\n=== DB state depois do teste 8 (${allAfter.length} pedidos) ===`);
    for (const r of allAfter) {
      console.log(`  ${r.external_order_id}: forecast=${r.delivery_forecast_date}, delivered=${r.delivered_date}`);
    }

    const afterRow = db.prepare("select delivery_forecast_date from orders where external_order_id = ?").get([targetOrder.saleNumber]) as any;
    console.log(`Depois: afterRow=${JSON.stringify(afterRow)}, forecast=${afterRow?.delivery_forecast_date}`);
    expect(afterRow?.delivery_forecast_date).toBe("2026-08-20");
  });

  it("simula bug antigo: orders com delivery NULL, reimport popula", async () => {
    console.log(`\n=== Simulando cenário do usuário: orders com delivery NULL ===`);

    db.exec("update orders set delivery_forecast_date = null, delivered_date = null");
    const nulled = db.prepare("select count(*) as c from orders where delivery_forecast_date is null and delivered_date is null").get([null]) as any;
    console.log(`Orders com delivery NULL: ${nulled.c}`);

    const buf = fs.readFileSync(XLSX_PATH);
    const { orders } = parseMercadoLivreXlsx(buf);

    const result = await importMercadoLivre(orders, "reimport-after-fix.xlsx");
    console.log(`Resultado do reimport: updated=${result.updatedOrders}, duplicated=${result.duplicatedOrders}`);

    const stillNull = db.prepare("select count(*) as c from orders where delivery_forecast_date is null and delivered_date is null").get([null]) as any;
    const withForecast = db.prepare("select count(*) as c from orders where delivery_forecast_date is not null").get([null]) as any;
    const withDelivered = db.prepare("select count(*) as c from orders where delivered_date is not null and delivered_date != ''").get([null]) as any;

    console.log(`Após reimport:`);
    console.log(`  Orders com delivery ainda NULL: ${stillNull.c}`);
    console.log(`  Orders com delivery_forecast_date: ${withForecast.c}`);
    console.log(`  Orders com delivered_date: ${withDelivered.c}`);

    expect(stillNull.c).toBe(0);
    expect(withForecast.c).toBeGreaterThan(0);
  });
});
