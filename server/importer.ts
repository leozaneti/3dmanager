import { db, literal } from "./db.js";
import type { ParsedOrder } from "./xlsxParser.js";
import { mapStatus } from "./importShared.js";
import { isDevolvido, getStatusId } from "./statusConfig.js";
import {
  expectedFinancialsFor,
  matchProductByTitle,
  normalizeFinancialsForStorage,
  type ProductMatchInfo,
} from "./financials.js";
import { STATE_NAMES } from "./brazilianStates.js";

export type ImportResult = {
  importedOrders: number;
  duplicatedOrders: number;
  updatedOrders: number;
  ignoredOrders: number;
  createdCustomers: number;
  reusedCustomers: number;
  updatedCustomers: number;
  importedItems: number;
  ignoredItems: number;
  errors: { line: number; message: string }[];
  logId: number;
};

interface ResolvedItem {
  sku: string;
  title: string;
  quantity: number;
  unitPrice: number;
  productId: number | null;
  costCents: number;
}

interface ResolvedOrder {
  checkKey: string;
  customerId: number;
  order: ParsedOrder;
  items: ResolvedItem[];
  statusId: number;
}

export async function importMercadoLivre(orders: ParsedOrder[], fileName: string, onProgress?: (current: number, total: number) => void): Promise<ImportResult> {
  const startTime = Date.now();
  const errors: ImportResult["errors"] = [];
  let importedOrders = 0;
  let duplicatedOrders = 0;
  let updatedOrders = 0;
  let ignoredOrders = 0;
  let createdCustomers = 0;
  let reusedCustomers = 0;
  let updatedCustomers = 0;
  let importedItems = 0;
  let ignoredItems = 0;

  const customerCache = new Map<string, number>();
  const orderCache = new Map<string, boolean>();

  const salesChannelId = singleVal("select id from sales_channels where name = 'Mercado Livre'") ?? 1;
  const storeId = singleVal("select id from stores order by id limit 1") ?? 1;

  const allStatuses = (db.prepare("select id, name from order_statuses").all() as { id: number; name: string }[]);
  const statusMap = new Map(allStatuses.map(s => [s.name.toLowerCase(), s.id]));
  const defaultStatusId = statusMap.get("novo") ?? 1;

  // Pre-cache product data (id + cost + sku) for all SKUs referenced
  const productCache = new Map<string, { productId: number | null; costCents: number; sku?: string }>();

  // Pre-load all products for name-based matching
  const productList: ProductMatchInfo[] = (db.prepare("select id, name, sku, current_cost_cents from products").all() as any[]).map((r: any) => ({
    id: r.id, name: r.name, sku: r.sku, costCents: r.current_cost_cents,
  }));

  const titleMatchCache = new Map<string, { productId: number | null; costCents: number; sku?: string }>();

  const resolvedOrders: ResolvedOrder[] = [];
  let processedCount = 0;

  for (const order of orders) {
    const checkKey = order.saleNumber || order.orderNumber;
    if (!checkKey) { processedCount++; onProgress?.(processedCount, orders.length); continue; }

    if (orderCache.has(checkKey)) {
      duplicatedOrders++;
      processedCount++; onProgress?.(processedCount, orders.length);
      continue;
    }
    orderCache.set(checkKey, true);

    const existingOrder = single("select id from orders where external_order_id = ? and sales_channel_id = ?", [checkKey, salesChannelId]);

    // Resolve products: cache lookup + check existence
    const resolvedItems: ResolvedItem[] = [];
    let hasMissingProduct = false;
    for (const item of order.items) {
      let titleFallbackAttempted = false;

      // Fallback: when SKU is blank, try to find product by name/keywords
      if (!item.sku && item.title && item.quantity > 0) {
        titleFallbackAttempted = true;
        const cacheKey = item.title.toLowerCase().trim();
        let prod = titleMatchCache.get(cacheKey);
        if (prod === undefined) {
          const matched = matchProductByTitle(productList, item.title);
          prod = matched
            ? { productId: matched.id, costCents: matched.costCents, sku: matched.sku }
            : { productId: null, costCents: 0 };
          titleMatchCache.set(cacheKey, prod);
        }
        if (prod.productId && prod.sku) {
          resolvedItems.push({ sku: prod.sku, title: item.title, quantity: item.quantity, unitPrice: item.unitPrice, productId: prod.productId, costCents: prod.costCents });
          continue;
        }
        hasMissingProduct = true;
        resolvedItems.push({ sku: "", title: item.title, quantity: item.quantity, unitPrice: item.unitPrice, productId: null, costCents: 0 });
        continue;
      }

      if (!item.sku || !item.title || item.quantity <= 0) {
        const msg = titleFallbackAttempted
          ? `Item ignorado no pedido ${checkKey}: SKU não preenchido e produto "${item.title}" não encontrado no cadastro`
          : `Item ignorado no pedido ${checkKey}: SKU "${item.sku}" inválido (sem título ou quantidade)`;
        errors.push({ line: 0, message: msg });
        ignoredItems++;
        continue;
      }
      let prod = productCache.get(item.sku);
      if (prod === undefined) {
        const row = single("select id, current_cost_cents from products where sku = ?", [item.sku]) as any;
        prod = { productId: row?.id ?? null, costCents: row?.current_cost_cents ?? 0 };
        productCache.set(item.sku, prod);
      }
      if (!prod.productId) {
        hasMissingProduct = true;
      }
      resolvedItems.push({ sku: item.sku, title: item.title, quantity: item.quantity, unitPrice: item.unitPrice, ...prod });
    }

    if (hasMissingProduct && resolvedItems.some(i => !i.productId)) {
      const missingSkus = resolvedItems.filter(i => !i.productId).map(i => i.sku || i.title).join(", ");
      const reason = `produto(s) não cadastrado(s): ${missingSkus}`;
      errors.push({ line: 0, message: `Pedido ${checkKey} ignorado — ${reason}` });
      console.warn(`[importMercadoLivre] Pedido ${checkKey} ignorado: ${reason}`);
      ignoredOrders++;
      processedCount++; onProgress?.(processedCount, orders.length);
      continue;
    }

    const orderStatusId = mapStatus(order.status, order.statusDescription, statusMap, defaultStatusId);

    if (existingOrder) {
      const existingId = (existingOrder as any).id;
      const changed = hasOrderChanged(existingId, {
        statusId: orderStatusId,
        statusDescription: order.statusDescription,
        financials: {
          productsRevenue: order.financials.productsRevenue,
          shippingFee: order.financials.shippingFee,
          shippingRevenue: order.financials.shippingRevenue,
          platformFee: order.financials.platformFee,
          discount: order.financials.discount,
          total: order.financials.total,
        },
        items: resolvedItems,
        notes: "",
        delivery: { sentDate: order.delivery?.sentDate, deliveredDate: order.delivery?.deliveredDate },
      });
      if (changed) {
        updateExistingOrder(existingId, {
          statusId: orderStatusId,
          statusDescription: order.statusDescription,
          financials: {
            productsRevenue: order.financials.productsRevenue,
            shippingFee: order.financials.shippingFee,
            shippingRevenue: order.financials.shippingRevenue,
            platformFee: order.financials.platformFee,
            discount: order.financials.discount,
            total: order.financials.total,
          },
          items: resolvedItems,
          delivery: { sentDate: order.delivery?.sentDate, deliveredDate: order.delivery?.deliveredDate },
        });
        updatedOrders++;
        db.log("update", "order", existingId, `Pedido reimportado`);
      } else {
        duplicatedOrders++;
      }
      processedCount++; onProgress?.(processedCount, orders.length);
      continue;
    }

    const customerResult = await ensureCustomer(order, customerCache);
    if (!customerResult) {
      const reason = `cliente inválido (buyerName="${order.buyerName}")`;
      errors.push({ line: 0, message: `Cliente "${order.buyerName}" inválido, pedido ${checkKey} ignorado` });
      console.warn(`[importMercadoLivre] Pedido ${checkKey} ignorado: ${reason}`);
      ignoredOrders++;
      processedCount++; onProgress?.(processedCount, orders.length);
      continue;
    }

    if (customerResult.status === 'created') createdCustomers++;
    else if (customerResult.status === 'updated') updatedCustomers++;
    else if (customerResult.status === 'reused') reusedCustomers++;

    resolvedOrders.push({ checkKey, customerId: customerResult.id, order, items: resolvedItems, statusId: orderStatusId });
    processedCount++; onProgress?.(processedCount, orders.length);
  }

  // Phase 2: batch insert all orders in one transaction
  if (resolvedOrders.length > 0) {
    db.beginBatch();
    try {
      db.batch(`CREATE TEMP TABLE IF NOT EXISTS _oi (order_id INTEGER)`);
      for (const ro of resolvedOrders) {
        buildOrderBatch(ro, storeId, salesChannelId, ro.statusId);
      }
      db.commitBatch();

      /* Garantia extra: zera financeiros de qualquer pedido que ficou com status 6 */
      db.exec(`UPDATE order_financials SET
        products_amount_cents = 0, shipping_total_cents = 0,
        shipping_customer_cents = 0, platform_fee_cents = 0,
        discount_cents = 0, other_costs_cents = 0, amount_received_cents = 0,
        packaging_cents = 0, additional_costs_cents = 0
      WHERE order_id IN (SELECT id FROM orders WHERE status_id = ${getStatusId("devolvido")})`);
      db.exec(`UPDATE order_items SET cost_unit_cents = 0
        WHERE order_id IN (SELECT id FROM orders WHERE status_id = ${getStatusId("devolvido")})`);

      importedOrders = resolvedOrders.length;
    } catch (error) {
      db.rollbackBatch();
      errors.push({ line: 0, message: `Erro em lote na importação: ${(error as Error).message}` });
    }
  }

  // Count imported items from resolved orders
  for (const ro of resolvedOrders) {
    for (const item of ro.items) {
      importedItems++;
    }
  }

  const endTime = Date.now();
  const durationSec = ((endTime - startTime) / 1000).toFixed(1);

  const logResult = db.prepare(
    "insert into import_log (file_name, total_orders, imported, duplicated, updated, created_customers, reused_customers, updated_customers, imported_items, ignored_items, errors_count, duration_seconds, status) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(fileName, orders.length, importedOrders, duplicatedOrders, updatedOrders, createdCustomers, reusedCustomers, updatedCustomers, importedItems, ignoredItems, errors.length, Number(durationSec), "completed");
  const logId = Number(logResult.lastInsertRowid);

  return { importedOrders, duplicatedOrders, updatedOrders, ignoredOrders, createdCustomers, reusedCustomers, updatedCustomers, importedItems, ignoredItems, errors, logId };
}

function buildOrderBatch(ro: ResolvedOrder, storeId: number, salesChannelId: number, statusId: number) {
  const { order, customerId, checkKey, items } = ro;

  const isReturned = isDevolvido(statusId);
  const packagingCents = isReturned
    ? 0
    : (() => {
        const row = single("select value from settings where key = 'packaging_cost'") as any;
        return row ? Number(row.value) || 0 : 0;
      })();

  const normalized = normalizeFinancialsForStorage(order.financials, isReturned, packagingCents);
  const additionalCostsCents = 0;

  db.batch(`INSERT INTO orders (store_id, external_order_id, sale_date, status_id, status_description, sales_channel_id, customer_id, notes, delivery_forecast_date, delivered_date) VALUES (${literal(storeId)}, ${literal(checkKey)}, ${literal(order.saleDate)}, ${literal(statusId)}, ${literal(order.statusDescription)}, ${literal(salesChannelId)}, ${literal(customerId)}, '', ${literal(order.delivery?.sentDate || null)}, ${literal(order.delivery?.deliveredDate || null)})`);

  db.batch(`DELETE FROM _oi`);
  db.batch(`INSERT INTO _oi SELECT last_insert_rowid()`);

  db.batch(`INSERT INTO order_financials (order_id, products_amount_cents, shipping_total_cents, shipping_customer_cents, platform_fee_cents, discount_cents, other_costs_cents, amount_received_cents, packaging_cents, additional_costs_cents) VALUES ((SELECT order_id FROM _oi), ${literal(normalized.productsAmountCents)}, ${literal(normalized.shippingTotalCents)}, ${literal(normalized.shippingCustomerCents)}, ${literal(normalized.platformFeeCents)}, ${literal(normalized.discountCents)}, ${literal(normalized.otherCostsCents)}, ${literal(normalized.amountReceivedCents)}, ${literal(normalized.packagingCents)}, ${literal(additionalCostsCents)})`);

  for (const item of items) {
    db.batch(`INSERT INTO order_items (order_id, product_id, sku, listing_title, quantity, sale_unit_price_cents, cost_unit_cents) VALUES ((SELECT order_id FROM _oi), ${literal(item.productId)}, ${literal(item.sku)}, ${literal(item.title)}, ${literal(item.quantity)}, ${literal(item.unitPrice)}, ${literal(isReturned ? 0 : item.costCents)})`);
  }
}

function hasOrderChanged(existingId: number, data: {
  statusId: number;
  statusDescription: string;
  financials: { productsRevenue: number; shippingFee: number; shippingRevenue: number; platformFee: number; discount: number; total: number; };
  items: ResolvedItem[];
  notes: string;
  delivery?: { sentDate?: string; deliveredDate?: string };
}): boolean {
  const current = single("select o.*, of.* from orders o join order_financials of on of.order_id = o.id where o.id = ?", [existingId]) as any;
  if (!current) return false;

  if (current.status_id !== data.statusId) return true;
  if (String(current.status_description ?? "") !== data.statusDescription) return true;

  const isReturned = isDevolvido(data.statusId);
  const expected = expectedFinancialsFor(data.financials, isReturned, current.packaging_cents);

  if (current.products_amount_cents !== expected.products) return true;
  if (current.shipping_total_cents !== expected.shippingTotal) return true;
  if (current.shipping_customer_cents !== expected.shippingCustomer) return true;
  if (current.platform_fee_cents !== expected.fee) return true;
  if (current.discount_cents !== expected.discount) return true;
  if (current.other_costs_cents !== expected.cupom) return true;
  if (current.amount_received_cents !== expected.amountReceived) return true;

  const currentItems = db.prepare("select sku, quantity, sale_unit_price_cents, cost_unit_cents from order_items where order_id = ? order by id").all([existingId]) as any[];
  if (currentItems.length !== data.items.length) return true;
  for (let i = 0; i < data.items.length; i++) {
    const ci = currentItems[i];
    const ni = data.items[i];
    if (ci.sku !== ni.sku || ci.quantity !== ni.quantity || ci.sale_unit_price_cents !== ni.unitPrice) return true;
  }

  const del = data.delivery;
  if (del) {
    if ((del.sentDate || null) !== (current.delivery_forecast_date || null)) return true;
    if ((del.deliveredDate || null) !== (current.delivered_date || null)) return true;
  }

  return false;
}

function updateExistingOrder(existingId: number, data: {
  statusId: number;
  statusDescription: string;
  financials: { productsRevenue: number; shippingFee: number; shippingRevenue: number; platformFee: number; discount: number; total: number; };
  items: ResolvedItem[];
  delivery?: { sentDate?: string; deliveredDate?: string };
}) {
  const current = single("select status_id from orders where id = ?", [existingId]) as any;
  const currentStatusId = current?.status_id ?? 0;
  const finalStatusId = data.statusId;
  const oldStatusName = single("select name from order_statuses where id = ?", [currentStatusId]) as any;
  const newStatusName = single("select name from order_statuses where id = ?", [data.statusId]) as any;

  const isReturned = isDevolvido(finalStatusId);
  const existingFin = single("select packaging_cents, additional_costs_cents from order_financials where order_id = ?", [existingId]) as any;
  const currentPackaging = existingFin?.packaging_cents ?? 0;
  const currentAdditional = existingFin?.additional_costs_cents ?? 0;

  const expected = expectedFinancialsFor(data.financials, isReturned, currentPackaging);

  const del = data.delivery;
  db.prepare(`update orders set status_id = ?, status_description = ?, delivery_forecast_date = coalesce(?, delivery_forecast_date), delivered_date = coalesce(?, delivered_date), updated_at = current_timestamp where id = ?`).run(
    finalStatusId, data.statusDescription, del?.sentDate || null, del?.deliveredDate || null, existingId
  );

  db.prepare(
    "update order_financials set products_amount_cents = ?, shipping_total_cents = ?, shipping_customer_cents = ?, platform_fee_cents = ?, discount_cents = ?, other_costs_cents = ?, amount_received_cents = ?, packaging_cents = ?, additional_costs_cents = ? where order_id = ?"
  ).run(
    expected.products, expected.shippingTotal, expected.shippingCustomer,
    expected.fee, expected.discount, expected.cupom, expected.amountReceived,
    isReturned ? 0 : currentPackaging, isReturned ? 0 : currentAdditional, existingId
  );

  const existingItems = db.prepare("select id, sku, cost_unit_cents from order_items where order_id = ?").all([existingId]) as any[];
  const newSkus = new Set(data.items.map(i => i.sku));

  for (const ni of data.items) {
    const existing = existingItems.find((ei: any) => ei.sku === ni.sku);
    if (existing) {
      db.prepare("update order_items set quantity = ?, sale_unit_price_cents = ?, listing_title = ?, cost_unit_cents = ? where id = ?").run(
        ni.quantity, ni.unitPrice, ni.title, isReturned ? 0 : existing.cost_unit_cents, existing.id
      );
    } else {
      db.prepare("insert into order_items (order_id, product_id, sku, listing_title, quantity, sale_unit_price_cents, cost_unit_cents) values (?, ?, ?, ?, ?, ?, ?)").run(
        existingId, ni.productId, ni.sku, ni.title, ni.quantity, ni.unitPrice, isReturned ? 0 : ni.costCents
      );
    }
  }

  for (const ei of existingItems) {
    if (!newSkus.has(ei.sku as string)) {
      db.prepare("delete from order_items where id = ?").run(ei.id);
    }
  }

  if (currentStatusId !== data.statusId) {
    db.prepare(
      "insert into audit_log (action, entity, entity_id, description) values (?, ?, ?, ?)"
    ).run("update", "order", existingId, `Status atualizado na reimport: ${oldStatusName?.name ?? currentStatusId} → ${newStatusName?.name ?? data.statusId}`);
  }
}

type CustomerStatus = { id: number; status: 'created' | 'reused' | 'updated' };

async function ensureCustomer(order: ParsedOrder, cache: Map<string, number>): Promise<CustomerStatus | null> {
  if (!order.buyerName) return null;

  const cacheKey = order.document || `${order.buyerName}|${order.cep}`;
  const cached = cache.get(cacheKey);
  if (cached) return { id: cached, status: 'reused' };

  const parsed = await parseAddress(order.address, order.city, order.state, order.cep);
  const logradouro = parsed.logradouro;
  const numero = parsed.numero;
  const complemento = parsed.complemento;
  const bairro = parsed.bairro;

  if (order.document && !isAllEmpty(order.document)) {
    const existingRow = single("select id, name, cep, logradouro, numero, complemento, bairro, cidade, estado from customers where document = ?", [order.document]);
    if (existingRow) {
      const cur = Number((existingRow as any).id);
      cache.set(cacheKey, cur);
      const ex = existingRow as Record<string, string>;
      const merges: [string, unknown][] = [
        ["name", order.buyerName],
        ["cep", order.cep],
        ["logradouro", logradouro],
        ["numero", numero],
        ["complemento", complemento],
        ["bairro", bairro],
        ["cidade", order.city],
        ["estado", order.state],
      ];
      const fields: string[] = [];
      const values: unknown[] = [];
      for (const [col, val] of merges) {
        if (!ex[col] || String(ex[col]).trim() === "") {
          fields.push(`${col} = ?`);
          values.push(val);
        }
      }
      if (fields.length > 0) {
        fields.push("updated_at = current_timestamp");
        db.prepare(`update customers set ${fields.join(", ")} where id = ?`).run(...values, cur);
        return { id: cur, status: 'updated' };
      }
      return { id: cur, status: 'reused' };
    }
  }

  if (order.buyerName && order.cep) {
    const existingRow = single("select id from customers where name = ? and cep = ?", [order.buyerName, order.cep]);
    if (existingRow) {
      const cur = (existingRow as any).id;
      cache.set(cacheKey, cur);
      return { id: cur, status: 'reused' };
    }
  }

  const result = db.prepare(
    "insert into customers (name, document, cep, logradouro, numero, complemento, bairro, cidade, estado) values (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(order.buyerName, order.document, order.cep, logradouro, numero, complemento, bairro, order.city, order.state);
  const id = Number(result.lastInsertRowid);
  cache.set(cacheKey, id);
  return { id, status: 'created' };
}

function singleVal(sql: string, params: unknown[] = []): number | undefined {
  const rows = db.prepare(sql).all(params);
  if (rows.length === 0) return undefined;
  const first = Object.values(rows[0])[0];
  return typeof first === "number" && Number.isFinite(first) ? first : Number(first);
}

function single(sql: string, params: unknown[] = []): Record<string, unknown> | undefined {
  const rows = db.prepare(sql).all(params);
  return rows && rows.length > 0 ? (rows[0] as Record<string, unknown>) : undefined;
}

function isAllEmpty(value: string | undefined): boolean {
  return !value || value.replace(/[\s-]/g, "").length === 0;
}

const viaCepCache = new Map<string, { logradouro: string; bairro: string } | null>();

async function fetchAddressByCEP(cep: string): Promise<{ logradouro: string; bairro: string } | null> {
  const clean = cep.replace(/\D/g, "");
  if (clean.length !== 8) return null;
  if (viaCepCache.has(clean)) return viaCepCache.get(clean) ?? null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) { viaCepCache.set(clean, null); return null; }
    const data = await res.json() as Record<string, string>;
    if (data.erro) { viaCepCache.set(clean, null); return null; }
    const result = { logradouro: data.logradouro || "", bairro: data.bairro || "" };
    viaCepCache.set(clean, result);
    return result;
  } catch {
    viaCepCache.set(clean, null);
    return null;
  }
}

function normalizeStreet(s: string): string {
  return s
    .replace(/\bR\.\s*/gi, "Rua ")
    .replace(/\bAv\.\s*/gi, "Avenida ")
    .replace(/\bAv\s+/gi, "Avenida ")
    .replace(/\bTrav\.\s*/gi, "Travessa ")
    .replace(/\bTr\.\s*/gi, "Travessa ")
    .replace(/\bTv\.\s*/gi, "Travessa ")
    .replace(/\bP[cç]a\.\s*/gi, "Praça ")
    .replace(/\bEst\.\s*/gi, "Estrada ")
    .replace(/\bEstr\.\s*/gi, "Estrada ")
    .replace(/\bAl\.\s*/gi, "Alameda ")
    .replace(/\bRod\.\s*/gi, "Rodovia ")
    .trim();
}

function removePart(address: string, part: string): string {
  if (!part || !address) return address;
  const escaped = part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return address.replace(new RegExp(`[,;\\-–—|/\\s]*${escaped}[,;\\-–—|/\\s]*`, "gi"), " ");
}

function extractNumberAndComplement(text: string): { numero: string; complemento: string } {
  if (!text) return { numero: "", complemento: "" };

  const sN = text.match(/^(s\s*\/\s*n|sem\s*n[úu]mero)\s*[,.\s\/-]?\s*(.*)$/i);
  if (sN) return { numero: "s/n", complemento: sN[2].trim() };
  if (/^(s\s*\/\s*n|sem\s*n[úu]mero)$/i.test(text.trim())) return { numero: "s/n", complemento: "" };

  const num = text.match(/^(\d[\d\s]*)\s*[,.\s\/;-]\s*(.*)$/);
  if (num) {
    let comp = num[2].replace(/^[,.\s\/;-]+/, "").trim();
    return { numero: num[1].trim(), complemento: comp };
  }

  if (/^\d[\d\s]*$/.test(text.trim())) return { numero: text.trim(), complemento: "" };

  return { numero: text.trim(), complemento: "" };
}

async function parseAddress(
  fullAddress: string,
  knownCidade: string,
  knownEstado: string,
  knownCep: string,
): Promise<{ logradouro: string; numero: string; complemento: string; bairro: string }> {
  const viaCep = await fetchAddressByCEP(knownCep);

  const cepClean = knownCep.replace(/\D/g, "");

  const knownParts: string[] = [];
  if (cepClean.length === 8) {
    knownParts.push(cepClean);
    knownParts.push(`${cepClean.slice(0, 5)}-${cepClean.slice(5)}`);
    knownParts.push("CEP");
  }
  if (knownCidade) knownParts.push(knownCidade);
  if (knownEstado) {
    knownParts.push(knownEstado);
    if (STATE_NAMES[knownEstado.toUpperCase()]) knownParts.push(STATE_NAMES[knownEstado.toUpperCase()]);
  }

  let logradouro = "";
  let bairro = "";

  if (viaCep && viaCep.logradouro) {
    logradouro = viaCep.logradouro;
    bairro = viaCep.bairro || "";
    const logradouroNorm = normalizeStreet(logradouro);
    const bairroNorm = normalizeStreet(bairro);
    if (logradouroNorm) knownParts.push(logradouroNorm);
    if (bairroNorm && bairroNorm !== logradouroNorm) knownParts.push(bairroNorm);
  }

  let remaining = normalizeStreet(fullAddress);
  for (const part of knownParts) {
    remaining = removePart(remaining, part);
  }
  remaining = remaining.replace(/\s+/g, " ").trim();
  remaining = remaining.replace(/^[\s,;\-–—|/]+/, "").replace(/[\s,;\-–—|/]+$/, "").trim();

  let { numero, complemento } = extractNumberAndComplement(remaining);

  if (viaCep && viaCep.logradouro) {
    return { logradouro: viaCep.logradouro, numero, complemento, bairro: viaCep.bairro || "" };
  }

  // Fallback: full address parsing without ViaCEP
  const parts = remaining.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const numFallback = parts[1].match(/^(\d[\d\s]*)(.*)$/);
    if (numFallback) {
      logradouro = parts[0];
      numero = numFallback[1].trim();
      complemento = (numFallback[2] + (parts.length > 2 ? ", " + parts.slice(2).join(", ") : "")).replace(/^[,.\s\/;-]+/, "").trim();
    } else {
      logradouro = parts[0];
      numero = "";
      complemento = parts.slice(1).join(", ");
    }
  } else {
    const m = remaining.match(/^(.+?)\s+(\d[\d\s/]*)(.*)$/);
    if (m) {
      logradouro = m[1].trim();
      numero = m[2].trim();
      complemento = m[3].trim();
    } else {
      logradouro = remaining;
    }
  }

  return { logradouro, numero, complemento, bairro };
}
