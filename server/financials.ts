import { normalize } from "./importShared.js";

/**
 * Inputs financeiros "brutos" de uma venda, como chegam do parser xlsx / API.
 * Todos os valores em centavos (podem ser negativos para taxas/descontos).
 */
export type RawOrderFinancials = {
  productsRevenue: number;
  shippingRevenue: number;
  shippingFee: number;
  platformFee: number;
  discount: number;
  total: number;
};

export type StoredOrderFinancials = {
  productsAmountCents: number;
  shippingTotalCents: number;
  shippingCustomerCents: number;
  platformFeeCents: number;
  discountCents: number;
  otherCostsCents: number;
  amountReceivedCents: number;
  packagingCents: number;
  additionalCostsCents: number;
};

/**
 * Regra de negócio: pedidos com status "Devolvido" têm TODOS os valores financeiros zerados
 * (estorno). O custo unitário dos itens também é zerado porque a mercadoria voltou ao estoque.
 */
export function zeroIfReturned(value: number, isReturned: boolean): number {
  return isReturned ? 0 : value;
}

/**
 * Calcula o "cupom" (other_costs_cents) a partir do gap entre o `total` reportado pelo ML
 * e a soma dos componentes. Se o total é menor que a soma esperada, a diferença (negativa)
 * é armazenada como custo positivo em `other_costs_cents` para que o DRE feche.
 *
 * Para pedidos devolvidos, sempre retorna 0.
 */
export function computeCupomCents(fin: RawOrderFinancials, isReturned: boolean): number {
  if (isReturned) return 0;
  const finSum = fin.productsRevenue + fin.shippingRevenue + fin.platformFee + fin.shippingFee;
  const gap = fin.total - finSum - fin.discount;
  return gap < 0 ? -gap : 0;
}

/**
 * Converte os valores brutos do parser xlsx nos valores a persistir em `order_financials`,
 * aplicando a regra de estorno automático quando o pedido é "Devolvido".
 *
 * Os valores são normalizados para `Math.abs` quando a fonte (ML) pode vir negativa
 * (taxa, frete, desconto).
 */
export function normalizeFinancialsForStorage(
  fin: RawOrderFinancials,
  isReturned: boolean,
  packagingCents: number = 0,
): Pick<
  StoredOrderFinancials,
  | "productsAmountCents"
  | "shippingTotalCents"
  | "shippingCustomerCents"
  | "platformFeeCents"
  | "discountCents"
  | "otherCostsCents"
  | "amountReceivedCents"
  | "packagingCents"
> {
  return {
    productsAmountCents: zeroIfReturned(fin.productsRevenue, isReturned),
    shippingTotalCents: zeroIfReturned(Math.abs(fin.shippingFee), isReturned),
    shippingCustomerCents: zeroIfReturned(fin.shippingRevenue, isReturned),
    platformFeeCents: zeroIfReturned(Math.abs(fin.platformFee), isReturned),
    discountCents: zeroIfReturned(Math.abs(fin.discount), isReturned),
    otherCostsCents: computeCupomCents(fin, isReturned),
    amountReceivedCents: zeroIfReturned(fin.total, isReturned),
    packagingCents: zeroIfReturned(packagingCents, isReturned),
  };
}

/**
 * Valores esperados para `order_financials` quando se compara um pedido já armazenado
 * com dados novos vindos de reimport. Aplica a mesma regra de "Devolvido zera".
 */
export function expectedFinancialsFor(
  fin: RawOrderFinancials,
  isReturned: boolean,
  existingPackagingCents: number = 0,
): {
  products: number;
  shippingTotal: number;
  shippingCustomer: number;
  fee: number;
  discount: number;
  cupom: number;
  amountReceived: number;
  packaging: number;
} {
  return {
    products: zeroIfReturned(fin.productsRevenue, isReturned),
    shippingTotal: zeroIfReturned(Math.abs(fin.shippingFee), isReturned),
    shippingCustomer: zeroIfReturned(fin.shippingRevenue, isReturned),
    fee: zeroIfReturned(Math.abs(fin.platformFee), isReturned),
    discount: zeroIfReturned(Math.abs(fin.discount), isReturned),
    cupom: computeCupomCents(fin, isReturned),
    amountReceived: zeroIfReturned(fin.total, isReturned),
    packaging: zeroIfReturned(existingPackagingCents, isReturned),
  };
}

export type ProductMatchInfo = {
  id: number;
  name: string;
  sku: string;
  costCents: number;
};

const STOPWORDS = new Set([
  "de", "da", "do", "das", "dos", "para", "com", "uma", "um", "em",
  "no", "na", "por", "voce", "você", "sua", "seu", "mais", "pra", "que",
  "pro", "aos", "nas", "nos", "sem", "ate", "até",
]);

/**
 * Lista de colunas de `order_financials` que recebem zero no estorno de pedidos
 * "Devolvido". Útil para montar `UPDATE ... SET col1=0, col2=0, ...` sem repetir
 * a lista de 9 colunas em cada query.
 */
export const ORDER_FINANCIALS_COLUMNS = [
  "products_amount_cents",
  "shipping_total_cents",
  "shipping_customer_cents",
  "platform_fee_cents",
  "discount_cents",
  "other_costs_cents",
  "amount_received_cents",
  "packaging_cents",
  "additional_costs_cents",
] as const;

/**
 * Gera o trecho `col1=0, col2=0, ...` para usar em `UPDATE order_financials SET ...`
 * quando o pedido foi marcado como "Devolvido".
 */
export function zeroFinancialsSetClause(): string {
  return ORDER_FINANCIALS_COLUMNS.map((c) => `${c} = 0`).join(", ");
}

/**
 * Tokeniza um título em keywords, removendo stopwords, normalizando acentos
 * e descartando tokens muito curtos (< 3 caracteres).
 */
function titleToKeywords(title: string): string[] {
  return normalize(title)
    .split(/[\s,;:/()\[\]–—\-]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * Faz fuzzy match de um título contra uma lista de produtos usando interseção
 * de keywords. Retorna o melhor candidato se ele atingir o limiar mínimo.
 *
 * Algoritmo:
 *  1. Tokeniza o título em keywords (sem stopwords)
 *  2. Pré-filtra produtos cuja `nameNorm` não contém a primeira keyword
 *  3. Conta quantas keywords cada candidato contém
 *  4. Retorna o de maior score se >= threshold (2 keywords = exige match exato,
 *     senão ceil(n/2))
 */
export function matchProductByTitle<T extends ProductMatchInfo>(
  products: T[],
  title: string,
): T | null {
  const keywords = titleToKeywords(title);
  if (keywords.length === 0) return null;

  let bestScore = 0;
  let best: T | null = null;
  for (const p of products) {
    const nameNorm = normalize(p.name);
    if (!nameNorm.includes(keywords[0])) continue;
    let score = 0;
    for (const kw of keywords) {
      if (nameNorm.includes(kw)) score++;
    }
    if (
      score > bestScore ||
      (score === bestScore && best && nameNorm.length > normalize(best.name).length)
    ) {
      bestScore = score;
      best = p;
    }
  }

  const threshold = keywords.length === 2 ? 2 : Math.max(1, Math.ceil(keywords.length / 2));
  return bestScore >= threshold ? best : null;
}
