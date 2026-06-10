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

describe("calculateOrderTotals", () => {
  it("calcula grossRevenueCents = products + shippingCustomer", () => {
    const r = calculateOrderTotals(BASE);
    expect(r.grossRevenueCents).toBe(11500);
  });

  it("calcula shippingSubsidyCents = shippingTotal - shippingCustomer", () => {
    const r = calculateOrderTotals(BASE);
    expect(r.shippingSubsidyCents).toBe(500);
  });

  it("calcula profitCents corretamente", () => {
    const r = calculateOrderTotals(BASE);
    expect(r.profitCents).toBe(6000);
  });

  it("calcula marginPercent corretamente", () => {
    const r = calculateOrderTotals(BASE);
    expect(r.marginPercent).toBeCloseTo(52.17, 1);
  });

  it("retorna marginPercent = 0 quando grossRevenue = 0", () => {
    const r = calculateOrderTotals({ ...BASE, productsAmountCents: 0, shippingCustomerCents: 0 });
    expect(r.marginPercent).toBe(0);
  });

  it("lida com prejuízo (profit negativo)", () => {
    const r = calculateOrderTotals({ ...BASE, itemsCostCents: 20000 });
    expect(r.profitCents).toBeLessThan(0);
    expect(r.marginPercent).toBeLessThan(0);
  });

  it("considera discountCents em saleResultCents", () => {
    const r = calculateOrderTotals({ ...BASE, discountCents: 1000 });
    expect(r.saleResultCents).toBe(10000);
  });

  it("operationalCostCents inclui platformFee + shippingTotal + otherCosts + packaging + additionalCosts - discount", () => {
    const r = calculateOrderTotals({
      ...BASE,
      platformFeeCents: 300,
      shippingTotalCents: 1000,
      otherCostsCents: 200,
      packagingCents: 100,
      additionalCostsCents: 50,
      discountCents: 150,
    });
    expect(r.operationalCostCents).toBe(1500);
  });

  it("todos os campos do retorno existem", () => {
    const r = calculateOrderTotals(BASE);
    expect(r).toHaveProperty("shippingSubsidyCents");
    expect(r).toHaveProperty("grossRevenueCents");
    expect(r).toHaveProperty("operationalCostCents");
    expect(r).toHaveProperty("netRevenueCents");
    expect(r).toHaveProperty("itemsCostCents");
    expect(r).toHaveProperty("saleResultCents");
    expect(r).toHaveProperty("profitCents");
    expect(r).toHaveProperty("marginPercent");
  });

  it("netRevenueCents = grossRevenue - operationalCost", () => {
    const r = calculateOrderTotals(BASE);
    expect(r.netRevenueCents).toBe(r.grossRevenueCents - r.operationalCostCents);
  });

  it("profitCents = netRevenue - itemsCost", () => {
    const r = calculateOrderTotals(BASE);
    expect(r.profitCents).toBe(r.netRevenueCents - r.itemsCostCents);
  });

  it("shippingSubsidy negativo quando shippingCustomer > shippingTotal", () => {
    const r = calculateOrderTotals({ ...BASE, shippingTotalCents: 500, shippingCustomerCents: 2000 });
    expect(r.shippingSubsidyCents).toBe(-1500);
  });

  it("tudo zerado", () => {
    const r = calculateOrderTotals({
      productsAmountCents: 0, shippingTotalCents: 0, shippingCustomerCents: 0,
      platformFeeCents: 0, discountCents: 0, otherCostsCents: 0, itemsCostCents: 0,
      packagingCents: 0, additionalCostsCents: 0,
    });
    expect(r.grossRevenueCents).toBe(0);
    expect(r.profitCents).toBe(0);
    expect(r.marginPercent).toBe(0);
  });

  it("valores muito grandes", () => {
    const r = calculateOrderTotals({ ...BASE, productsAmountCents: 10_000_000, itemsCostCents: 8_000_000 });
    expect(r.grossRevenueCents).toBe(10_001_500);
    expect(r.profitCents).toBeGreaterThan(0);
  });

  it("apenas custos sem receita (prejuízo total)", () => {
    const r = calculateOrderTotals({
      productsAmountCents: 0, shippingTotalCents: 1000, shippingCustomerCents: 0,
      platformFeeCents: 500, discountCents: 0, otherCostsCents: 200,
      itemsCostCents: 3000, packagingCents: 100, additionalCostsCents: 0,
    });
    expect(r.grossRevenueCents).toBe(0);
    expect(r.profitCents).toBeLessThan(0);
    expect(r.marginPercent).toBe(0);
  });

  it("saleResultCents = lucro + itemsCost + packaging + additionalCosts", () => {
    const r = calculateOrderTotals(BASE);
    expect(r.saleResultCents).toBe(r.profitCents + r.itemsCostCents);
  });
});
