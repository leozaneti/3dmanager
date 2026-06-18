import { describe, it, expect } from "vitest";
import { calculateOrderTotals } from "../calculations.js";

const BASE = {
  productsAmountCents: 10000,
  shippingTotalCents: 2000,
  shippingCustomerCents: 1500,
  platformFeeCents: 500,
  discountCents: 0,
  otherCostsCents: 0,
  itemsCostCents: 3000,
  packagingCents: 0,
  additionalCostsCents: 0,
};

const CASES = [
  { ...BASE },
  { ...BASE, productsAmountCents: 0, shippingCustomerCents: 0 },
  { ...BASE, itemsCostCents: 50000 },
  { ...BASE, discountCents: 1000 },
  { ...BASE, packagingCents: 500, additionalCostsCents: 300, otherCostsCents: 200 },
  { ...BASE, productsAmountCents: 10_000_000, itemsCostCents: 8_000_000 },
  { productsAmountCents: 0, shippingTotalCents: 1000, shippingCustomerCents: 0, platformFeeCents: 500, discountCents: 0, otherCostsCents: 200, itemsCostCents: 3000, packagingCents: 100, additionalCostsCents: 0 },
];

describe("calculateOrderTotals", () => {
  CASES.forEach((input, i) => {
    it(`caso ${i + 1}: retorna campos definidos e valores coerentes`, () => {
      const result = calculateOrderTotals(input);
      expect(result.grossRevenueCents).toBeDefined();
      expect(result.saleResultCents).toBeDefined();
      expect(result.profitCents).toBeDefined();
      expect(typeof result.marginPercent).toBe("number");
      expect(result.grossRevenueCents).toBe(input.productsAmountCents + input.shippingCustomerCents);
    });
  });
});
