// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { calculateOrderTotals } from "../../../server/calculations";

const BASE = {
  productsAmountCents: 10000,
  shippingCustomerCents: 1500,
  shippingTotalCents: 2000,
  platformFeeCents: 500,
  otherCostsCents: 0,
  discountCents: 0,
  itemsCostCents: 3000,
  packagingCents: 0,
  additionalCostsCents: 0,
};

describe("calculateOrderTotals", () => {
  it("grossRevenueCents = products + shippingCustomer", () => {
    const r = calculateOrderTotals(BASE);
    expect(r.grossRevenueCents).toBe(11500);
  });

  it("saleResultCents = grossRevenue - shippingTotal - platformFee - otherCosts + discount", () => {
    const r = calculateOrderTotals(BASE);
    expect(r.saleResultCents).toBe(9000);
  });

  it("profitCents = saleResult - itemsCost - packaging - additionalCosts", () => {
    const r = calculateOrderTotals(BASE);
    expect(r.profitCents).toBe(6000);
  });

  it("marginPercent = profit / grossRevenue * 100", () => {
    const r = calculateOrderTotals(BASE);
    expect(r.marginPercent).toBeCloseTo(52.17, 1);
  });

  it("marginPercent = 0 quando grossRevenue = 0", () => {
    const r = calculateOrderTotals({ ...BASE, productsAmountCents: 0, shippingCustomerCents: 0 });
    expect(r.marginPercent).toBe(0);
  });

  it("profit negativo quando custos > receita", () => {
    const r = calculateOrderTotals({ ...BASE, itemsCostCents: 50000 });
    expect(r.profitCents).toBeLessThan(0);
    expect(r.marginPercent).toBeLessThan(0);
  });

  it("packaging e additionalCosts reduzem o profit", () => {
    const sem = calculateOrderTotals(BASE);
    const com = calculateOrderTotals({ ...BASE, packagingCents: 500, additionalCostsCents: 300 });
    expect(com.profitCents).toBe(sem.profitCents - 800);
  });

  it("discountCents aumenta saleResult", () => {
    const r = calculateOrderTotals({ ...BASE, discountCents: 1000 });
    expect(r.saleResultCents).toBe(10000);
  });

  it("retorna os campos", () => {
    const r = calculateOrderTotals(BASE);
    expect(r.grossRevenueCents).toBeDefined();
    expect(r.saleResultCents).toBeDefined();
    expect(r.profitCents).toBeDefined();
    expect(r.marginPercent).toBeDefined();
  });
});
