// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { money, toCents, fromCents } from "../api";

function normalize(s: string) {
  return s.replace(/\s/g, " ");
}

describe("money", () => {
  it("formata 1500 como R$ 15,00", () => {
    expect(normalize(money(1500))).toBe("R$ 15,00");
  });

  it("formata 0 como R$ 0,00", () => {
    expect(normalize(money(0))).toBe("R$ 0,00");
  });

  it("formata undefined como R$ 0,00", () => {
    expect(normalize(money(undefined))).toBe("R$ 0,00");
  });

  it("formata valor negativo", () => {
    expect(normalize(money(-500))).toBe("-R$ 5,00");
  });

  it("formata valor grande com separador de milhar", () => {
    expect(normalize(money(123456))).toBe("R$ 1.234,56");
  });

  it("formata 1 centavo", () => {
    expect(normalize(money(1))).toBe("R$ 0,01");
  });
});

describe("toCents", () => {
  it("converte '15,50' para 1550", () => {
    expect(toCents("15,50")).toBe(1550);
  });

  it("converte '1.234,56' para 123456", () => {
    expect(toCents("1.234,56")).toBe(123456);
  });

  it("converte string vazia para 0", () => {
    expect(toCents("")).toBe(0);
  });

  it("converte null para 0", () => {
    expect(toCents(null)).toBe(0);
  });

  it("converte '0' para 0", () => {
    expect(toCents("0")).toBe(0);
  });

  it("converte valor invalido 'abc' para 0", () => {
    expect(toCents("abc")).toBe(0);
  });
});

describe("fromCents", () => {
  it("converte 1550 para '15,50'", () => {
    expect(fromCents(1550)).toBe("15,50");
  });

  it("converte 0 para '0,00'", () => {
    expect(fromCents(0)).toBe("0,00");
  });

  it("converte undefined para '0,00'", () => {
    expect(fromCents(undefined)).toBe("0,00");
  });

  it("converte 123456 para '1234,56'", () => {
    expect(fromCents(123456)).toBe("1234,56");
  });

  it("converte valor negativo -1550 para '-15,50'", () => {
    expect(fromCents(-1550)).toBe("-15,50");
  });
});

describe("money valores extremos", () => {
  it("formata valor muito grande (10 bilhoes de centavos)", () => {
    expect(normalize(money(10_000_000_000))).toBe("R$ 100.000.000,00");
  });

  it("formata 999999999 centavos", () => {
    expect(normalize(money(999999999))).toBe("R$ 9.999.999,99");
  });
});
