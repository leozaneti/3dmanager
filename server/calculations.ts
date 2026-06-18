/**
 * Valores financeiros de um pedido (todos em centavos, INTEGER).
 * Vêm das colunas de `order_financials` + soma de `order_items.cost_unit_cents`.
 */
type OrderTotalsInput = {
  productsAmountCents: number;
  shippingTotalCents: number;
  shippingCustomerCents: number;
  platformFeeCents: number;
  discountCents: number;
  otherCostsCents: number;
  itemsCostCents: number;
  packagingCents: number;
  additionalCostsCents: number;
};

/**
 * Calcula todos os derivados financeiros de um pedido a partir dos campos
 * brutos de `order_financials`.
 *
 * Fórmulas:
 *   shippingSubsidy = freteTotal − freteRecebido
 *     → Subsídio: o lojista pagou `freteTotal` mas o cliente pagou `freteRecebido`.
 *        Se positivo, o lojista arcou com a diferença.
 *   grossRevenue = valorProdutos + freteRecebido
 *     → Receita bruta: o que entrou de fato (produto + frete pago pelo cliente).
 *   operationalCost = taxas + freteTotal + outros + embalagem + adicionais − desconto
 *     → Custo operacional total da venda.
 *   netRevenue = grossRevenue − operationalCost
 *     → Receita líquida após custos operacionais.
 *   profit = netRevenue − custoItens
 *     → Lucro final: o que sobra depois de pagar todos os custos e a produção.
 *   margin = (profit / grossRevenue) × 100
 *     → Margem percentual sobre a receita bruta.
 *   saleResult = grossRevenue − taxaPlataforma − freteTotal − outrosCustos + desconto
 *     → Resultado da venda: valor líquido que o Mercado Pago efetivamente repassa.
 *        Diferente de netRevenue porque exclui embalagem e custos adicionais
 *        (esses não são descontados pelo MP, são custos internos da loja).
 */
export function calculateOrderTotals(input: OrderTotalsInput) {
  const shippingSubsidyCents = input.shippingTotalCents - input.shippingCustomerCents;
  const grossRevenueCents = input.productsAmountCents + input.shippingCustomerCents;
  const operationalCostCents =
    input.platformFeeCents + input.shippingTotalCents + input.otherCostsCents + input.packagingCents + input.additionalCostsCents - input.discountCents;
  const netRevenueCents = grossRevenueCents - operationalCostCents;
  const profitCents = netRevenueCents - input.itemsCostCents;
  const marginPercent = grossRevenueCents > 0 ? (profitCents / grossRevenueCents) * 100 : 0;

  const saleResultCents = grossRevenueCents - input.platformFeeCents - input.shippingTotalCents - input.otherCostsCents + input.discountCents;

  return {
    shippingSubsidyCents,
    grossRevenueCents,
    operationalCostCents,
    netRevenueCents,
    itemsCostCents: input.itemsCostCents,
    saleResultCents,
    profitCents,
    marginPercent
  };
}
