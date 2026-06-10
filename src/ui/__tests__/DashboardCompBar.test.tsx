// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DashboardCompBar } from "../dashboard/DashboardCompBar";
import type { DashboardTotals } from "../dashboard-types";

const totals: DashboardTotals = {
  orderCount: 1,
  grossRevenueCents: 10000,
  netRevenueCents: 6000,
  saleResultCents: 8000,
  profitCents: 2000,
  itemsCostCents: 4000,
  shippingCustomerCents: 1000,
  shippingSubsidyCents: 500,
  totalItems: 2,
  totalCostCents: 3000,
  avgTicketCents: 10000,
  marginPercent: 20,
};

describe("DashboardCompBar", () => {
  it("renderiza os 3 segmentos", () => {
    const { container } = render(<DashboardCompBar totals={totals} />);
    const segs = container.querySelectorAll(".stacked-seg");
    expect(segs.length).toBe(3);
  });

  it("exibe labels na legenda", () => {
    render(<DashboardCompBar totals={totals} />);
    expect(screen.getByText("Custo de Produção")).toBeDefined();
    expect(screen.getByText("Taxas + Frete")).toBeDefined();
    expect(screen.getByText("Lucro")).toBeDefined();
  });

  it("calcula productionCost = itemsCost + (saleResult - netRevenue)", () => {
    const { container } = render(<DashboardCompBar totals={totals} />);
    const segs = container.querySelectorAll(".stacked-seg");
    expect(segs[0].textContent).toContain("60,00");
  });

  it("nao quebra com grossRevenue = 0", () => {
    const zero = { ...totals, grossRevenueCents: 0, profitCents: 0, netRevenueCents: 0, saleResultCents: 0, itemsCostCents: 0 };
    const { container } = render(<DashboardCompBar totals={zero} />);
    const segs = container.querySelectorAll(".stacked-seg");
    expect(segs.length).toBe(3);
  });

  it("percentuais somam ~100%", () => {
    const { container } = render(<DashboardCompBar totals={totals} />);
    const segs = container.querySelectorAll(".stacked-seg");
    const pcts = Array.from(segs).map(s => {
      const match = s.textContent?.match(/([\d.]+)%/);
      return match ? parseFloat(match[1]) : 0;
    });
    const sum = pcts.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(100, 0.5);
  });
});
