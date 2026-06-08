const API = "http://127.0.0.1:3333/api";

const cookieJar: string[] = [];

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
      Cookie: cookieJar.join("; "),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "API error");
  }
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    const match = setCookie.match(/session=([^;]+)/);
    if (match) cookieJar.push(`session=${match[1]}`);
  }
  return res.json() as Promise<T>;
}

async function apiLogin() {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "teste123" }),
  });
  if (res.ok) {
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const match = setCookie.match(/session=([^;]+)/);
      if (match) cookieJar.push(`session=${match[1]}`);
    }
    return;
  }
  const res2 = await fetch(`${API}/auth/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "teste123" }),
  });
  if (!res2.ok) throw new Error("Falha ao configurar senha para o seed");
  const setCookie = res2.headers.get("set-cookie");
  if (setCookie) {
    const match = setCookie.match(/session=([^;]+)/);
    if (match) cookieJar.push(`session=${match[1]}`);
  }
}

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

const firstNames = [
  "João", "Maria", "Pedro", "Ana", "Carlos", "Juliana", "Lucas", "Mariana",
  "Gabriel", "Beatriz", "Rafael", "Fernanda", "Felipe", "Camila", "Matheus",
  "Amanda", "Gustavo", "Larissa", "Bruno", "Letícia", "Thiago", "Vanessa",
  "Rodrigo", "Patrícia", "Daniel", "Carolina", "Eduardo", "Isabela", "Vinicius",
  "Natália", "Diego", "Renata", "Leonardo", "Aline", "Ricardo", "Tatiane",
  "Alexandre", "Priscila", "André", "Débora", "Fernando", "Elaine", "Marcos",
  "Cristiane", "Leandro", "Gisele", "Fábio", "Simone", "Paulo", "Raquel",
  "César", "Jéssica", "Igor", "Michelle", "Renan", "Michele", "Hugo", "Viviane",
  "Guilherme", "Luciana", "Otávio", "Mônica", "Jorge", "Sandra", "Caio", "Daniela",
  "Luan", "Sabrina", "Henrique", "Bruna", "Arthur", "Tatiana", "Murilo", "Cláudia",
  "Samuel", "Vanessa", "Enzo", "Lorena", "Breno", "Tamires", "Vitor", "Francine",
  "Erick", "Jaqueline", "Nelson", "Andressa", "Márcio", "Alessandra", "Ruan", "Lívia",
  "Elton", "Milena", "Wagner", "Fabiana", "Rogério", "Márcia", "Willian", "Bianca",
  "Ivan", "Elisa", "Alex", "Carla", "Sérgio", "Rita", "Alberto", "Tainá", "Elias",
  "Suelen", "Milton", "Helena", "Adriano", "Sofia", "Mauro", "Alice", "Valdir", "Eduarda",
  "Flávio", "Lavinia", "Antônio", "Manuela", "José", "Valentina", "Sebastião", "Laura",
];

const lastNames = [
  "Silva", "Santos", "Oliveira", "Souza", "Lima", "Pereira", "Costa", "Ferreira",
  "Rodrigues", "Almeida", "Nascimento", "Araújo", "Ribeiro", "Carvalho", "Gomes",
  "Martins", "Barbosa", "Rocha", "Dias", "Moreira", "Castro", "Melo", "Cavalcanti",
  "Teixeira", "Cardoso", "Correia", "Mendes", "Vieira", "Freitas", "Marques",
  "Machado", "Brito", "Nunes", "Rezende", "Guimarães", "Pinto", "Campos", "Borges",
  "Lopes", "Fernandes", "Cunha", "Vargas", "Neves", "Assis", "Barros", "Coelho",
  "Monteiro", "Duarte", "Xavier", "Pimenta", "Andrade", "Baptista", "Azevedo",
  "Peixoto", "Lacerda", "Fonseca", "Dantas", "Leite", "Macedo", "Padilha", "Bueno",
  "Teles", "Braz", "Caldeira", "Goulart", "Alves", "Beghetti", "Escobar", "Zaneti",
];

const streetNames = [
  "Rua das Flores", "Av. Paulista", "Rua XV de Novembro", "Rua Sete de Setembro",
  "Av. Brasil", "Rua do Comércio", "Rua Tiradentes", "Av. Getúlio Vargas",
  "Rua Dom Pedro II", "Rua Marechal Deodoro", "Rua Santos Dumont", "Rua José Bonifácio",
  "Rua Visconde de Mauá", "Rua São João", "Rua da Praia", "Rua do Imperador",
  "Av. Rio Branco", "Rua Princesa Isabel", "Rua Duque de Caxias", "Rua Barão do Rio Branco",
  "Rua General Osório", "Rua Benjamin Constant", "Rua Olavo Bilac", "Rua Cel. João Cândido",
  "Rua do Rosário", "Av. Independência", "Rua Dr. João Pessoa", "Rua da Alfândega",
];

const cities = [
  "São Paulo", "Rio de Janeiro", "Belo Horizonte", "Curitiba", "Porto Alegre",
  "Brasília", "Salvador", "Fortaleza", "Recife", "Campinas", "São Bernardo do Campo",
  "Santo André", "Ribeirão Preto", "Uberlândia", "Contagem", "Juiz de Fora", "Niterói",
  "Caxias do Sul", "Londrina", "Maringá", "Florianópolis", "Goiânia", "Manaus",
  "Poços de Caldas", "Guarulhos", "Osasco", "Sorocaba", "São José dos Campos",
];

const states = [
  "SP", "RJ", "MG", "PR", "RS", "DF", "BA", "CE", "PE", "SC", "GO", "AM", "ES",
];

const productNames = [
  { name: "Coaster ABS", sku: "CST-ABS-001", weight: 12, time: 25 },
  { name: "Coaster PLA", sku: "CST-PLA-001", weight: 10, time: 22 },
  { name: "Suporte Celular", sku: "SUP-CEL-001", weight: 28, time: 90 },
  { name: "Porta Canetas", sku: "POR-CAN-001", weight: 35, time: 110 },
  { name: "Vaso Geométrico", sku: "VAS-GEO-001", weight: 45, time: 180 },
  { name: "Chaveiro Personalizado", sku: "CHA-PER-001", weight: 6, time: 15 },
  { name: "Mini Vaso Suculenta", sku: "VAS-SUC-001", weight: 18, time: 60 },
  { name: "Brinco Articulado", sku: "BRI-ART-001", weight: 3, time: 20 },
  { name: "Suporte Tablet", sku: "SUP-TAB-001", weight: 40, time: 150 },
  { name: "Mascote 3D 5cm", sku: "MAS-3D-005", weight: 8, time: 35 },
  { name: "Mascote 3D 10cm", sku: "MAS-3D-010", weight: 22, time: 80 },
  { name: "Mascote 3D 15cm", sku: "MAS-3D-015", weight: 50, time: 160 },
  { name: "Jogo Xadrez (peão)", sku: "XAD-PEA-001", weight: 7, time: 16 },
  { name: "Jogo Xadrez (torre)", sku: "XAD-TOR-001", weight: 12, time: 28 },
  { name: "Jogo Xadrez (cavalo)", sku: "XAD-CAV-001", weight: 14, time: 35 },
  { name: "Abajur Mini", sku: "ABA-MIN-001", weight: 32, time: 130 },
  { name: " porta Treco", sku: "POR-TRE-001", weight: 25, time: 75 },
  { name: "Cabide Infantil", sku: "CAB-INF-001", weight: 15, time: 40 },
  { name: "Suporte Fone", sku: "SUP-FON-001", weight: 20, time: 55 },
  { name: "Organizador Gaveta", sku: "ORG-GAV-001", weight: 38, time: 145 },
]; // 20 products

async function seedProducts() {
  console.log("Creating 20 products...");
  for (const p of productNames) {
    // calculate auto cost
    const settingsRes = await api<any>("/settings");
    const s = settingsRes as Record<string, { value: string }>;
    const pla = Number(s["pla_price_per_kg"]?.value ?? "10000");
    const energy = Number(s["energy_cost_per_hour"]?.value ?? "10");
    const machine = Number(s["machine_value"]?.value ?? "800000");
    const lifespan = Number(s["machine_lifespan_hours"]?.value ?? "3000");
    const maint = Number(s["maintenance_factor"]?.value ?? "10");
    const error = Number(s["error_rate"]?.value ?? "10");

    const materialCents = Math.round((p.weight / 1000) * (pla));
    const energyCents = Math.round((p.time / 60) * energy);
    const machineHourCost = (machine / lifespan) * (1 + maint / 100);
    const machineCents = Math.round((p.time / 60) * machineHourCost);
    const subtotal = materialCents + energyCents + machineCents;
    const errorCents = Math.round(subtotal * (error / 100));
    const totalCost = subtotal + errorCents;

    await api("/products", {
      method: "POST",
      body: JSON.stringify({
        name: p.name,
        sku: p.sku,
        currentCostCents: totalCost,
        weightGrams: p.weight,
        printTimeMinutes: p.time,
        additionalCostCents: 0,
        active: true,
      }),
    });

    // apply the calculated cost as current_cost_cents
    // The POST calculates cost, but we want exact to match our formula for seed data
    // We'll update it directly
    const productsRes = await api<{ data: any[] }>("/products");
    const created = productsRes.data.find((pr: any) => pr.sku === p.sku);
    if (created) {
      await api(`/products/${created.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: p.name,
          sku: p.sku,
          currentCostCents: totalCost,
          weightGrams: p.weight,
          printTimeMinutes: p.time,
          additionalCostCents: 0,
          active: true,
        }),
      });
    }
  }
  console.log("  20 products created.");
}

async function seedCustomers() {
  console.log("Creating 130 customers...");
  const usedCombos = new Set<string>();
  for (let i = 0; i < 130; i++) {
    let firstName, lastName, name;
    do {
      firstName = pick(firstNames);
      lastName = pick(lastNames);
      name = `${firstName} ${lastName}`;
    } while (usedCombos.has(name));
    usedCombos.add(name);

    const hasDoc = Math.random() > 0.15;
    let document = "";
    if (hasDoc) {
      if (Math.random() > 0.3) {
        // CPF
        const cpf = Array.from({ length: 11 }, () => rand(0, 9)).join("");
        document = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9, 11)}`;
      } else {
        // CNPJ
        const cnpj = Array.from({ length: 14 }, () => rand(0, 9)).join("");
        document = `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12, 14)}`;
      }
    }

    const phone = `(${rand(11, 99)}) 9${rand(1000, 9999)}-${rand(1000, 9999)}`;
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${rand(1, 999)}@email.com`;
    const city = pick(cities);
    const stateIdx = states.indexOf(
      (() => {
        const idx = cities.indexOf(city);
        if (idx <= 4) return pick(states);
        if (idx <= 9) return "SP";
        if (idx <= 12) return "MG";
        if (idx <= 16) return "RJ";
        if (idx <= 19) return "PR";
        if (idx <= 21) return "SC";
        if (idx <= 22) return "RS";
        return pick(states);
      })()
    );
    const state = stateIdx >= 0 ? states[stateIdx] : pick(states);
    const street = pick(streetNames);
    const numero = String(rand(10, 9999));

    await api("/customers", {
      method: "POST",
      body: JSON.stringify({
        name,
        document,
        phone,
        email,
        cep: `${rand(10000, 99999)}-${rand(100, 999)}`,
        logradouro: street,
        numero,
        complemento: Math.random() > 0.7 ? `Apto ${rand(1, 100)}` : "",
        bairro: "Centro",
        cidade: city,
        estado: state,
        notes: Math.random() > 0.8 ? "Cliente recorrente" : "",
      }),
    });
  }
  console.log("  130 customers created.");
}

async function seedOrders() {
  console.log("Creating 200 orders...");

  const meta = await api<{ stores: { id: number }[]; channels: { id: number }[]; statuses: { id: number; isFinal: number }[] }>("/meta");
  const customersRes = await api<{ data: { id: number }[] }>("/customers");
  const productsRes = await api<{ data: any[] }>("/products");
  const customers = customersRes.data;
  const products = productsRes.data;

  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - 90); // last 90 days

  const storeId = meta.stores[0]?.id ?? 1;

  for (let i = 0; i < 200; i++) {
    const saleDate = new Date(startDate.getTime() + Math.random() * (today.getTime() - startDate.getTime()));
    const dateStr = saleDate.toISOString().slice(0, 10);

    const channel = pick(meta.channels);
    const status = weightedPick(meta.statuses, [5, 5, 10, 60, 20]); // mostly "Entregue"
    const customer = Math.random() > 0.08 ? pick(customers).id : null;

    // 1 to 5 items
    const itemCount = weightedPick([1, 2, 3, 4, 5], [40, 30, 18, 8, 4]);
    const items: any[] = [];
    let itemsCost = 0;
    let amountReceived = 0;

    for (let j = 0; j < itemCount; j++) {
      const product = pick(products);
      const qty = weightedPick([1, 2, 3, 4], [60, 25, 10, 5]);
      const salePrice = product.currentCostCents + rand(200, 3000); // cost + R$2 to R$30 margin
      const cost = product.currentCostCents;
      itemsCost += cost * qty;
      amountReceived += salePrice * qty;
      items.push({
        productId: product.id,
        sku: product.sku,
        listingTitle: product.name,
        quantity: qty,
        saleUnitPriceCents: salePrice,
        costUnitCents: cost,
      });
    }

    const shippingTotal = rand(0, 3000);
    const shippingCustomer = Math.random() > 0.3 ? rand(0, shippingTotal) : 0;
    const platformFee = Math.round(amountReceived * (pick([10, 12, 14, 16, 18]) / 100));
    const discount = Math.random() > 0.7 ? rand(0, Math.round(amountReceived * 0.15)) : 0;
    const otherCosts = Math.random() > 0.7 ? rand(0, 1500) : 0;

    await api("/orders", {
      method: "POST",
      body: JSON.stringify({
        storeId,
        externalOrderId: `EXT-${dateStr.replace(/-/g, "")}-${String(i + 1).padStart(3, "0")}`,
        saleDate: dateStr,
        statusId: status.id,
        statusDescription: "",
        salesChannelId: channel.id,
        customerId: customer,
        notes: "",
        financials: {
          productsAmountCents: amountReceived,
          shippingTotalCents: shippingTotal,
          shippingCustomerCents: shippingCustomer,
          platformFeeCents: platformFee,
          discountCents: discount,
          otherCostsCents: otherCosts,
          amountReceivedCents: amountReceived + shippingCustomer,
        },
        items,
      }),
    });

    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/200 orders created...`);
  }
  console.log("  200 orders created.");
}

async function main() {
  console.log("Seeding database...\n");
  await apiLogin();
  await seedProducts();
  await seedCustomers();
  await seedOrders();
  console.log("\nDone! Database seeded successfully.");
}

main().catch((err) => {
  console.error("Error during seed:", err);
  process.exit(1);
});
