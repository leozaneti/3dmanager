// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OrderFinancialSidebar } from "../OrderFinancialSidebar";

const items = [
  { listingTitle: "Produto A", sku: "A001", quantity: 2, saleUnitPriceCents: 5000, costUnitCents: 2000 },
  { listingTitle: "Produto B", sku: "B001", quantity: 1, saleUnitPriceCents: 3000, costUnitCents: 1000 },
];

const defaultProps = {
  items,
  shippingTotalCents: 2000,
  shippingCustomerCents: 1500,
  platformFeeCents: 500,
  discountCents: 0,
  otherCostsCents: 0,
  packagingCents: 0,
  additionalCostsCents: 0,
};

describe("OrderFinancialSidebar", () => {
  it("renderiza secoes de receita, taxas e custos", () => {
    render(<OrderFinancialSidebar {...defaultProps} />);
    expect(screen.getByText("Receita da Venda")).toBeDefined();
    expect(screen.getByText("Taxas e Frete")).toBeDefined();
    expect(screen.getByText("Custos de Produção")).toBeDefined();
    expect(screen.getByText("Lucro Líquido")).toBeDefined();
  });

  it("exibe productsTotal = 2x5000 + 1x3000 = 13000", () => {
    render(<OrderFinancialSidebar {...defaultProps} />);
    const all = screen.getAllByText(/130,00/);
    expect(all.length).toBeGreaterThan(0);
  });

  it("exibe totalFeesDeduction = platformFee + shippingTotal - shippingCustomer - discount", () => {
    render(<OrderFinancialSidebar {...defaultProps} />);
    const all = screen.getAllByText(/10,00/);
    expect(all.length).toBeGreaterThan(0);
  });

  it("exibe profit na barra quando stage1Value > 0", () => {
    const { container } = render(<OrderFinancialSidebar {...defaultProps} />);
    const segs = container.querySelectorAll(".stacked-seg");
    expect(segs.length).toBe(3);
  });

  it("mostra cor verde no lucro quando profit >= 0", () => {
    const { container } = render(<OrderFinancialSidebar {...defaultProps} />);
    expect(container.querySelector(".seg-green")).toBeTruthy();
  });

  it("mostra cor vermelha no lucro quando profit < 0", () => {
    const prejuizo = { ...defaultProps, items: [{ ...items[0], costUnitCents: 10000 }] };
    const { container } = render(<OrderFinancialSidebar {...prejuizo} />);
    expect(container.querySelector(".seg-red")).toBeTruthy();
  });

  it("nao quebra com items vazio", () => {
    const { container } = render(<OrderFinancialSidebar {...defaultProps} items={[]} />);
    expect(container.querySelector(".stage-value")).toBeTruthy();
  });

  it("exibe margem percentual", () => {
    render(<OrderFinancialSidebar {...defaultProps} />);
    expect(screen.getByText(/48\.3/)).toBeDefined();
  });

  it("renderiza com discount, otherCosts, packaging e additionalCosts simultaneamente", () => {
    const complexProps = {
      ...defaultProps,
      discountCents: 500,
      otherCostsCents: 200,
      packagingCents: 300,
      additionalCostsCents: 100,
    };
    const { container } = render(<OrderFinancialSidebar {...complexProps} />);
    expect(screen.getByText("Receita da Venda")).toBeDefined();
    expect(container.querySelector(".stage-bar-fill")).toBeTruthy();
  });
});
