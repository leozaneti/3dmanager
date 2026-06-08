import { db, migrate } from "../db.js";

migrate();

const dataDir = new URL("../../data", import.meta.url).pathname;

console.log("Limpando tabelas...");
db.exec("PRAGMA foreign_keys = OFF;");
db.exec("DELETE FROM order_items;");
db.exec("DELETE FROM order_financials;");
db.exec("DELETE FROM orders;");
db.exec("DELETE FROM customers;");
db.exec("DELETE FROM products;");
db.exec("DELETE FROM audit_log;");
db.exec("DELETE FROM import_log;");
db.exec("DELETE FROM sqlite_sequence;");
db.exec("PRAGMA foreign_keys = ON;");
console.log("  Tabelas limpas.\n");

// ── Helpers ──────────────────────────────────────────
function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[rand(0, arr.length - 1)];
}

function weightedPick<T>(arr: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < arr.length; i++) {
    r -= weights[i];
    if (r <= 0) return arr[i];
  }
  return arr[arr.length - 1];
}

// ── 30 Produtos para loja 3D focada em donas de casa ──
const productDefs = [
  { name: "Organizador de Talheres", sku: "ORG-TAL-001", weight: 15, time: 45, cost: 350 },
  { name: "Porta-rolos Papel Toalha", sku: "POR-ROL-001", weight: 22, time: 70, cost: 500 },
  { name: "Suporte Celular Pra Cozinha", sku: "SUP-CEL-002", weight: 18, time: 55, cost: 400 },
  { name: "Vaso Suculenta Geométrico", sku: "VAS-SUC-002", weight: 12, time: 40, cost: 300 },
  { name: "Porta Grampos de Cabelo", sku: "POR-GRA-001", weight: 8, time: 25, cost: 200 },
  { name: "Organizador de Maquiagem", sku: "ORG-MAQ-001", weight: 35, time: 120, cost: 800 },
  { name: "Bandeja para Joias", sku: "BAN-JOI-001", weight: 20, time: 65, cost: 550 },
  { name: "Mini Cabideiro Decorativo", sku: "CAB-MIN-001", weight: 25, time: 80, cost: 600 },
  { name: "Suporte para Esponja", sku: "SUP-ESP-001", weight: 10, time: 30, cost: 250 },
  { name: "Porta-sabonete", sku: "POR-SAB-001", weight: 12, time: 35, cost: 300 },
  { name: "Escorredor de Escova de Dentes", sku: "ESC-DEN-001", weight: 14, time: 40, cost: 350 },
  { name: "Chaveiro Coração", sku: "CHA-COR-001", weight: 5, time: 12, cost: 150 },
  { name: "Chaveiro Flor", sku: "CHA-FLO-001", weight: 5, time: 12, cost: 150 },
  { name: "Placa Decorativa Bem-vindos", sku: "PLA-BEM-001", weight: 20, time: 60, cost: 500 },
  { name: "Porta-recados de Geladeira (Ímã)", sku: "POR-REC-001", weight: 8, time: 20, cost: 200 },
  { name: "Suporte para Pano de Prato", sku: "SUP-PAN-001", weight: 16, time: 50, cost: 400 },
  { name: "Porta-detergente", sku: "POR-DET-001", weight: 18, time: 55, cost: 450 },
  { name: "Organizador de Sacolas Plásticas", sku: "ORG-SAC-001", weight: 20, time: 60, cost: 500 },
  { name: "Puxador para Tampa de Panela", sku: "PUX-PAN-001", weight: 8, time: 20, cost: 200 },
  { name: "Suporte para Vassoura e Pano", sku: "SUP-VAS-001", weight: 30, time: 90, cost: 700 },
  { name: "Porta-condimentos", sku: "POR-CON-001", weight: 25, time: 80, cost: 650 },
  { name: "Bandeja para Cortar Pizza", sku: "BAN-PIZ-001", weight: 15, time: 45, cost: 350 },
  { name: "Forma para Ovos (6 un)", sku: "FOR-OVO-001", weight: 20, time: 60, cost: 500 },
  { name: "Molde para Biscoitos (3 un)", sku: "MOL-BIS-001", weight: 10, time: 30, cost: 250 },
  { name: "Porta-velas Coração", sku: "POR-VEL-001", weight: 8, time: 25, cost: 200 },
  { name: "Plaquinha para Identificar Plantas", sku: "PLA-PLA-001", weight: 6, time: 15, cost: 150 },
  { name: "Porta-temperos Magnético", sku: "POR-TEM-001", weight: 22, time: 70, cost: 550 },
  { name: "Suporte para Rolo de Filme PVC", sku: "SUP-FIL-001", weight: 18, time: 55, cost: 400 },
  { name: "Anel Guardanapo (4 un)", sku: "ANA-GUA-001", weight: 6, time: 18, cost: 180 },
  { name: "Multi-organizador de Gaveta", sku: "MUL-GAV-001", weight: 40, time: 140, cost: 900 },
];

console.log("Criando 30 produtos...");
const prodStmt = db.prepare(
  "INSERT INTO products (name, sku, current_cost_cents, weight_grams, print_time_minutes, additional_cost_cents, active) VALUES (?, ?, ?, ?, ?, 0, 1)"
);
for (const p of productDefs) {
  prodStmt.run(p.name, p.sku, p.cost, p.weight, p.time);
}
console.log("  30 produtos criados.\n");

// ── 200+ Clientes (maioria feminina para donas de casa) ──
const femaleNames = [
  "Maria", "Ana", "Juliana", "Mariana", "Beatriz", "Fernanda", "Camila",
  "Amanda", "Larissa", "Letícia", "Vanessa", "Patrícia", "Carolina",
  "Isabela", "Natália", "Renata", "Aline", "Tatiane", "Priscila", "Débora",
  "Elaine", "Cristiane", "Gisele", "Simone", "Raquel", "Jéssica", "Michelle",
  "Michele", "Viviane", "Luciana", "Mônica", "Sandra", "Daniela", "Sabrina",
  "Bruna", "Tatiana", "Cláudia", "Vanessa", "Lorena", "Tamires", "Francine",
  "Jaqueline", "Andressa", "Alessandra", "Lívia", "Milena", "Fabiana",
  "Márcia", "Bianca", "Elisa", "Carla", "Rita", "Tainá", "Suelen", "Helena",
  "Sofia", "Alice", "Eduarda", "Lavinia", "Manuela", "Valentina", "Laura",
  "Giovanna", "Isadora", "Cecília", "Clara", "Lara", "Marina", "Elisa",
  "Rebecca", "Vitoria", "Emanuelly", "Stella", "Maitê", "Liz", "Jade",
  "Melissa", "Bárbara", "Rose", "Sonia", "Tereza", "Fátima", "Dulce",
  "Vilma", "Célia", "Irene", "Lúcia", "Rosa", "Neusa",
];

const maleNames = [
  "João", "Pedro", "Carlos", "Lucas", "Gabriel", "Rafael", "Felipe",
  "Matheus", "Gustavo", "Bruno", "Thiago", "Rodrigo", "Daniel", "Eduardo",
  "Vinicius", "Diego", "Leonardo", "Ricardo", "Alexandre", "André",
  "Fernando", "Marcos", "Leandro", "Fábio", "Paulo", "César", "Igor",
  "Renan", "Hugo", "Guilherme", "Otávio", "Jorge", "Caio", "Luan",
  "Henrique", "Arthur", "Murilo", "Samuel", "Enzo", "Breno", "Vitor",
  "Erick", "Nelson", "Márcio", "Ruan", "Elton", "Wagner", "Rogério",
  "Willian", "Ivan", "Alex", "Sérgio", "Alberto", "Elias", "Milton",
  "Adriano", "Mauro", "Valdir", "Flávio", "Antônio", "José", "Sebastião",
  "Vicente", "Raimundo", "Francisco",
];

const lastNames = [
  "Silva", "Santos", "Oliveira", "Souza", "Lima", "Pereira", "Costa",
  "Ferreira", "Rodrigues", "Almeida", "Nascimento", "Araújo", "Ribeiro",
  "Carvalho", "Gomes", "Martins", "Barbosa", "Rocha", "Dias", "Moreira",
  "Castro", "Melo", "Cavalcanti", "Teixeira", "Cardoso", "Correia",
  "Mendes", "Vieira", "Freitas", "Marques", "Machado", "Brito", "Nunes",
  "Rezende", "Guimarães", "Pinto", "Campos", "Borges", "Lopes",
  "Fernandes", "Cunha", "Vargas", "Neves", "Assis", "Barros", "Coelho",
  "Monteiro", "Duarte", "Xavier", "Pimenta", "Andrade", "Azevedo",
  "Fonseca", "Dantas", "Leite", "Macedo", "Bueno", "Alves", "Teles",
  "Braz", "Caldeira", "Goulart",
];

const streetNames = [
  "Rua das Flores", "Rua XV de Novembro", "Rua Sete de Setembro",
  "Av. Brasil", "Rua do Comércio", "Rua Tiradentes", "Av. Getúlio Vargas",
  "Rua Dom Pedro II", "Rua Marechal Deodoro", "Rua Santos Dumont",
  "Rua José Bonifácio", "Rua São João", "Rua da Praia",
  "Av. Rio Branco", "Rua Princesa Isabel", "Rua Duque de Caxias",
  "Rua General Osório", "Rua Benjamin Constant", "Rua Olavo Bilac",
  "Rua do Rosário", "Av. Independência", "Rua Dr. João Pessoa",
  "Rua da Alfândega", "Rua Bela Vista", "Rua Nova Esperança",
  "Rua Boa Vista", "Rua Primavera", "Rua das Acácias",
];

const cities = [
  "São Paulo", "Rio de Janeiro", "Belo Horizonte", "Curitiba",
  "Porto Alegre", "Brasília", "Salvador", "Fortaleza", "Recife",
  "Campinas", "São Bernardo do Campo", "Santo André", "Ribeirão Preto",
  "Uberlândia", "Contagem", "Juiz de Fora", "Niterói",
  "Londrina", "Maringá", "Florianópolis", "Goiânia",
  "Sorocaba", "São José dos Campos", "Poços de Caldas",
];

const states = ["SP", "RJ", "MG", "PR", "RS", "SC", "DF", "GO", "BA"];

const streetByCity = (city: string) => {
  const mainStates: Record<string, string[]> = {
    "São Paulo": ["SP", "SP", "SP", "SP", "SP", "RJ", "MG"],
    "Rio de Janeiro": ["RJ", "RJ", "RJ", "RJ", "SP", "MG"],
    "Belo Horizonte": ["MG", "MG", "MG", "MG", "SP", "RJ"],
    "Curitiba": ["PR", "PR", "PR", "PR", "SC", "SP"],
    "Porto Alegre": ["RS", "RS", "RS", "RS", "SC", "SP"],
  };
  return mainStates[city] ?? ["SP", "RJ", "MG", "PR", "SC", "RS", "DF", "GO", "BA"];
};

const citiesByState: Record<string, string[]> = {};
cities.forEach(c => {
  const possibleStates = streetByCity(c);
  possibleStates.forEach(s => {
    if (!citiesByState[s]) citiesByState[s] = [];
    if (!citiesByState[s].includes(c)) citiesByState[s].push(c);
  });
});

const emails = [
  "gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "bol.com.br",
  "uol.com.br", "terra.com.br", "icloud.com",
];

console.log("Criando 200 clientes...");

// Mix mais feminino (70% mulheres)
const allFirstNames: string[] = [];
for (let i = 0; i < 140; i++) allFirstNames.push(pick(femaleNames));
for (let i = 0; i < 60; i++) allFirstNames.push(pick(maleNames));

const custStmt = db.prepare(
  "INSERT INTO customers (name, phone, email, document, cep, logradouro, numero, complemento, bairro, cidade, estado, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
);

const usedCombos = new Set<string>();
for (let i = 0; i < 200; i++) {
  let firstName: string, lastName: string, name: string;
  do {
    firstName = allFirstNames[i];
    lastName = pick(lastNames);
    name = `${firstName} ${lastName}`;
  } while (usedCombos.has(name));
  usedCombos.add(name);

  const city = pick(cities);
  const state = pick(streetByCity(city));

  const document = Math.random() > 0.1
    ? `${rand(100, 999)}.${rand(100, 999)}.${rand(100, 999)}-${rand(10, 99)}`
    : "";

  const phone = `(${rand(11, 99)}) 9${rand(1000, 9999)}-${rand(1000, 9999)}`;
  const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${rand(1, 999)}@${pick(emails)}`;
  const street = pick(streetNames);
  const numero = String(rand(10, 9999));
  const complemento = Math.random() > 0.65 ? `Apto ${rand(1, 100)}` : "";
  const cep = `${rand(10000, 99999)}-${rand(100, 999)}`;
  const notes = Math.random() > 0.85 ? "Cliente recorrente" : "";

  custStmt.run(
    name, phone, email, document, cep, street, numero, complemento,
    "Centro", city, state, notes
  );
}
console.log("  200 clientes criados.\n");

// ── ~400 Pedidos nos últimos 6 meses ──
console.log("Criando aproximadamente 400 pedidos...");

const storeId = 1;
const channelIds = [1, 2, 3, 4, 5]; // Mercado Livre, Shopee, Instagram, WhatsApp, Site
const channelWeights = [30, 25, 15, 20, 10];

// Get inserted products and customers
const products = db.prepare("SELECT id, current_cost_cents FROM products").all([]) as { id: number; current_cost_cents: number }[];
const customers = db.prepare("SELECT id FROM customers").all([]) as { id: number }[];

const today = new Date();
const sixMonthsAgo = new Date(today);
sixMonthsAgo.setMonth(today.getMonth() - 6);

const totalOrders = 400;
const batchSize = 50;

// Status distribution (mostly delivered/active)
const statusIds = [1, 2, 3, 4, 5, 6]; // Novo, Produção, Enviado, Entregue, Cancelado, Devolvido
const statusWeights = [5, 10, 15, 50, 15, 5];

let createdCount = 0;

for (let batch = 0; batch < totalOrders; batch += batchSize) {
  db.beginBatch();

  const end = Math.min(batch + batchSize, totalOrders);

  for (let i = batch; i < end; i++) {
    const saleDate = new Date(
      sixMonthsAgo.getTime() + Math.random() * (today.getTime() - sixMonthsAgo.getTime())
    );
    const dateStr = saleDate.toISOString().slice(0, 10);

    const channelId = weightedPick(channelIds, channelWeights);
    const statusId = weightedPick(statusIds, statusWeights);
    const customerId = Math.random() > 0.05 ? pick(customers).id : null;

    // 1 to 5 items
    const itemCount = weightedPick([1, 2, 3, 4, 5], [35, 30, 20, 10, 5]);
    let productsAmountCents = 0;
    let itemsCostCents = 0;
    const itemValues: { productId: number | null; sku: string; listingTitle: string; qty: number; salePrice: number; cost: number }[] = [];

    const usedProducts = new Set<number>();
    for (let j = 0; j < itemCount; j++) {
      let prod: { id: number; current_cost_cents: number };
      do {
        prod = pick(products);
      } while (usedProducts.has(prod.id) && usedProducts.size < products.length);
      usedProducts.add(prod.id);

      const qty = weightedPick([1, 2, 3], [60, 30, 10]);
      const markup = pick([1.3, 1.4, 1.5, 1.6, 1.8, 2.0, 2.2, 2.5]);
      const salePrice = Math.round(prod.current_cost_cents * markup);

      productsAmountCents += salePrice * qty;
      itemsCostCents += prod.current_cost_cents * qty;

      itemValues.push({
        productId: prod.id,
        sku: "",
        listingTitle: "",
        qty,
        salePrice,
        cost: prod.current_cost_cents,
      });
    }

    const shippingTotalCents = weightedPick([0, rand(500, 2500), rand(1500, 4000)], [20, 50, 30]);
    const shippingCustomerCents = channelId === 3 || channelId === 4 || channelId === 5
      ? Math.random() > 0.5 ? shippingTotalCents : 0
      : Math.random() > 0.3 ? rand(0, shippingTotalCents) : 0;
    const platformFeeCents = channelId === 1 || channelId === 2
      ? Math.round(productsAmountCents * pick([10, 12, 14, 16, 18]) / 100)
      : 0;
    const discountCents = Math.random() > 0.7 ? rand(0, Math.round(productsAmountCents * 0.12)) : 0;
    const otherCostsCents = Math.random() > 0.75 ? rand(0, 1000) : 0;
    const packagingCents = Math.round(itemCount * pick([100, 150, 200, 250]));
    const additionalCostsCents = 0;
    const amountReceivedCents = productsAmountCents + shippingCustomerCents;

    const externalOrderId = `3DP-${dateStr.replace(/-/g, "")}-${String(i + 1).padStart(4, "0")}`;

    db.batch(
      `INSERT INTO orders (store_id, external_order_id, sale_date, status_id, status_description, sales_channel_id, customer_id, notes, created_at, updated_at) VALUES (` +
      `${storeId}, '${externalOrderId}', '${dateStr}', ${statusId}, '', ${channelId}, ${customerId ?? "NULL"}, '', ` +
      `'${dateStr} 0${rand(8, 12)}:${rand(10, 59)}:00', '${dateStr} 0${rand(8, 12)}:${rand(10, 59)}:00')`
    );

    db.batch(
      `INSERT INTO order_financials (order_id, products_amount_cents, shipping_total_cents, shipping_customer_cents, ` +
      `platform_fee_cents, discount_cents, other_costs_cents, amount_received_cents, packaging_cents, additional_costs_cents) VALUES (` +
      `last_insert_rowid(), ${productsAmountCents}, ${shippingTotalCents}, ${shippingCustomerCents}, ` +
      `${platformFeeCents}, ${discountCents}, ${otherCostsCents}, ${amountReceivedCents}, ${packagingCents}, ${additionalCostsCents})`
    );

    for (const item of itemValues) {
      db.batch(
        `INSERT INTO order_items (order_id, product_id, sku, listing_title, quantity, sale_unit_price_cents, cost_unit_cents) VALUES (` +
        `last_insert_rowid(), ${item.productId}, '', '', ${item.qty}, ${item.salePrice}, ${item.cost})`
      );
    }

    createdCount++;
  }

  db.commitBatch();

  const pct = Math.round((end / totalOrders) * 100);
  const bars = "=".repeat(Math.round(pct / 2)) + " ".repeat(50 - Math.round(pct / 2));
  process.stdout.write(`\r  Progresso: [${bars}] ${pct}% (${createdCount}/${totalOrders})`);
}

console.log(`\n  ${createdCount} pedidos criados.\n`);
console.log("Seed concluído com sucesso!");
