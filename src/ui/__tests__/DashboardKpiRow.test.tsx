// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DashboardKpiRow } from "../dashboard/DashboardKpiRow";
import type { DashboardTotals } from "../dashboard-types";

const totals: DashboardTotals = {
  orderCount: 10,
  grossRevenueCents: 50000,
  netRevenueCents: 35000,
  saleResultCents: 40000,
  profitCents: 15000,
  itemsCostCents: 20000,
  shippingCustomerCents: 5000,
  shippingSubsidyCents: 1000,
  totalItems: 25,
  totalCostCents: 10000,
  avgTicketCents: 5000,
  marginPercent: 30,
};

const previous: DashboardTotals = {
  orderCount: 8,
  grossRevenueCents: 40000,
  netRevenueCents: 28000,
  saleResultCents: 32000,
  profitCents: 10000,
  itemsCostCents: 18000,
  shippingCustomerCents: 4000,
  shippingSubsidyCents: 800,
  totalItems: 20,
  totalCostCents: 8000,
  avgTicketCents: 4000,
  marginPercent: 25,
};

describe("DashboardKpiRow", () => {
  it("renderiza KPIs financeiros", () => {
    render(<DashboardKpiRow totals={totals} type="financial" />);
    expect(screen.getByText("Receita Bruta")).toBeDefined();
    expect(screen.getByText("Resultado da Venda")).toBeDefined();
    expect(screen.getByText("Lucro Líquido")).toBeDefined();
    expect(screen.getByText("Margem")).toBeDefined();
  });

  it("exibe valor da receita formatado", () => {
    render(<DashboardKpiRow totals={totals} type="financial" />);
    expect(screen.getByText(/R\$ 500,00/)).toBeDefined();
  });

  it("exibe margem percentual", () => {
    render(<DashboardKpiRow totals={totals} type="financial" />);
    const all = screen.getAllByText(/30\.0%/);
    expect(all.length).toBeGreaterThan(0);
  });

  it("exibe comparativo vs periodo anterior", () => {
    render(<DashboardKpiRow totals={totals} previous={previous} type="financial" />);
    const all = screen.getAllByText(/vs per/);
    expect(all.length).toBe(3);
  });

  it("renderiza KPIs operacionais", () => {
    render(<DashboardKpiRow totals={totals} type="operational" />);
    expect(screen.getByText("Pedidos")).toBeDefined();
    expect(screen.getByText("Ticket Médio")).toBeDefined();
    expect(screen.getByText("Itens / Pedido")).toBeDefined();
    expect(screen.getByText("Lucro por Pedido")).toBeDefined();
  });

  it("exibe contagem de pedidos", () => {
    render(<DashboardKpiRow totals={totals} type="operational" />);
    expect(screen.getByText("10")).toBeDefined();
  });

  it("aplica classe negative quando profit negativo", () => {
    const negativeProfit = { ...totals, profitCents: -5000, marginPercent: -10 };
    const { container } = render(<DashboardKpiRow totals={negativeProfit} type="financial" />);
    const hero = container.querySelector(".kpi-hero");
    expect(hero?.classList.contains("negative")).toBe(true);
  });

  it("calcula itens por pedido", () => {
    render(<DashboardKpiRow totals={totals} type="operational" />);
    expect(screen.getByText("2.5")).toBeDefined();
  });

  it("nao quebra com orderCount = 0 (divisao por zero)", () => {
    const zeroOrders = { ...totals, orderCount: 0, totalItems: 0, profitCents: 0 };
    const { container } = render(<DashboardKpiRow totals={zeroOrders} type="operational" />);
    expect(container.querySelector(".kpi-row")).toBeTruthy();
  });

  it("nao exibe comparativo quando previous e null/undefined", () => {
    render(<DashboardKpiRow totals={totals} type="financial" />);
    expect(screen.queryByText(/vs per/)).toBeNull();
  });

  it("nao quebra com previous = null no tipo operational", () => {
    render(<DashboardKpiRow totals={totals} previous={null} type="operational" />);
    expect(screen.getByText("Pedidos")).toBeDefined();
  });
});
