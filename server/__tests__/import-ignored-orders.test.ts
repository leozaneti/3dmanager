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

let counter = 0;
function nextId() { return ++counter; }

/* Helpers */
function ensureMercadoLivreChannel(): number {
  const existing = db.prepare("select id from sales_channels where name = 'Mercado Livre'").get([]) as any;
  if (existing) return existing.id;
  const r = db.prepare("insert into sales_channels (name) values (?)").run("Mercado Livre");
  return Number(r.lastInsertRowid);
}

function makeProduct(sku: string, costCents = 500) {
  const r = db.prepare("insert into products (name, sku, current_cost_cents) values (?, ?, ?)").run(`Produto ${sku}`, sku, costCents);
  return Number(r.lastInsertRowid);
}

function makeParsedOrder(saleNumber: string, sku: string, total: number, buyerName = "Cliente Teste") {
  return {
    saleNumber,
    orderNumber: "",
    buyerName,
    document: "12345678901",
    address: "Rua X, 123",
    city: "São Paulo",
    state: "SP",
    cep: "01000-000",
    country: "Brasil",
    saleDate: "2024-06-15",
    status: "Entregue",
    statusDescription: "Pacote entregue ao destinatário",
    channelPayment: "2024-06-15",
    items: [{ sku, title: "Produto Teste", variation: "", quantity: 1, unitPrice: total }],
    financials: {
      productsRevenue: total,
      shippingRevenue: 0,
      shippingFee: 0,
      platformFee: 0,
      discount: 0,
      total,
    },
    delivery: { method: "", trackingCode: "", trackingUrl: "", sentDate: "", deliveredDate: "2024-06-20" },
    raw: {} as any,
  } as any;
}

describe("import: ignoredOrders vs duplicatedOrders", () => {
  it("pedido sem SKU cadastrado → counted em ignoredOrders (não duplicatedOrders)", async () => {
    const { importMercadoLivre } = await import("../importer.js");
    ensureMercadoLivreChannel();

    /* SKU NÃO cadastrado — hasMissingProduct = true → ignored */
    const result = await importMercadoLivre([
      makeParsedOrder(`ML-${nextId()}`, "SKU-INEXISTENTE", 10000),
    ], "test.xlsx");

    expect(result.ignoredOrders).toBe(1);
    expect(result.duplicatedOrders).toBe(0);
    expect(result.importedOrders).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].message).toMatch(/SKU-INEXISTENTE/);
  });

  it("pedido já existente com mesmos dados → counted em duplicatedOrders (NÃO ignored)", async () => {
    const { importMercadoLivre } = await import("../importer.js");
    ensureMercadoLivreChannel();
    const productId = makeProduct("SKU-EXISTE", 500);
    const saleNumber = `ML-${nextId()}`;

    /* Primeiro import: cria o pedido */
    const first = await importMercadoLivre([
      makeParsedOrder(saleNumber, "SKU-EXISTE", 10000),
    ], "test.xlsx");
    expect(first.importedOrders).toBe(1);
    expect(first.duplicatedOrders).toBe(0);
    expect(first.ignoredOrders).toBe(0);

    /* Segundo import (mesmos dados): deve contar como duplicado, não como ignored */
    const second = await importMercadoLivre([
      makeParsedOrder(saleNumber, "SKU-EXISTE", 10000),
    ], "test.xlsx");
    expect(second.importedOrders).toBe(0);
    expect(second.duplicatedOrders).toBe(1);
    expect(second.ignoredOrders).toBe(0);
    expect(second.updatedOrders).toBe(0);
  });

  it("pedido já existente com dados diferentes → counted em updatedOrders", async () => {
    const { importMercadoLivre } = await import("../importer.js");
    ensureMercadoLivreChannel();
    const productId = makeProduct("SKU-EXISTE-2", 500);
    const saleNumber = `ML-${nextId()}`;

    const first = await importMercadoLivre([
      makeParsedOrder(saleNumber, "SKU-EXISTE-2", 10000),
    ], "test.xlsx");
    expect(first.importedOrders).toBe(1);

    /* Segundo import com valor diferente → updated */
    const second = await importMercadoLivre([
      makeParsedOrder(saleNumber, "SKU-EXISTE-2", 15000),
    ], "test.xlsx");
    expect(second.importedOrders).toBe(0);
    expect(second.duplicatedOrders).toBe(0);
    expect(second.ignoredOrders).toBe(0);
    expect(second.updatedOrders).toBe(1);
  });

  it("pedido sem nome do comprador → ignored (ensureCustomer falha)", async () => {
    const { importMercadoLivre } = await import("../importer.js");
    ensureMercadoLivreChannel();
    const productId = makeProduct("SKU-CLIENTE", 500);

    const order = makeParsedOrder(`ML-${nextId()}`, "SKU-CLIENTE", 10000, "" /* sem nome */);

    const result = await importMercadoLivre([order], "test.xlsx");
    expect(result.ignoredOrders).toBe(1);
    expect(result.duplicatedOrders).toBe(0);
  });

  it("pedido novo (não existente) com SKU válido → counted em importedOrders", async () => {
    const { importMercadoLivre } = await import("../importer.js");
    ensureMercadoLivreChannel();
    const productId = makeProduct("SKU-NEW", 500);

    const result = await importMercadoLivre([
      makeParsedOrder(`ML-${nextId()}`, "SKU-NEW", 10000),
    ], "test.xlsx");
    expect(result.importedOrders).toBe(1);
    expect(result.duplicatedOrders).toBe(0);
    expect(result.ignoredOrders).toBe(0);
  });
});
