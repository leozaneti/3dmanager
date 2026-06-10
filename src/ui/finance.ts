// ATENÇÃO: Fórmula duplicada em server/calculations.ts (calculateOrderTotals).
// Mantenha os dois arquivos em sincronia ao alterar a lógica financeira.
export function calculateKpisFromTotals(ft: {
  productsAmountCents: number;
  shippingCustomerCents: number;
  shippingTotalCents: number;
  platformFeeCents: number;
  otherCostsCents: number;
  discountCents: number;
  itemsCostCents: number;
  packagingCents: number;
  additionalCostsCents: number;
}) {
  const grossRevenueCents = ft.productsAmountCents + ft.shippingCustomerCents;
  const saleResultCents = grossRevenueCents - ft.shippingTotalCents - ft.platformFeeCents - ft.otherCostsCents + ft.discountCents;
  const profitCents = saleResultCents - ft.itemsCostCents - ft.packagingCents - ft.additionalCostsCents;
  const marginPercent = grossRevenueCents > 0 ? (profitCents / grossRevenueCents) * 100 : 0;
  return { grossRevenueCents, saleResultCents, profitCents, marginPercent };
}
