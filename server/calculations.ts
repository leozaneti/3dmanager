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
