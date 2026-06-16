import { describe, it, expect } from "vitest";
import {
  zeroIfReturned,
  computeCupomCents,
  normalizeFinancialsForStorage,
  expectedFinancialsFor,
  matchProductByTitle,
  zeroFinancialsSetClause,
  ORDER_FINANCIALS_COLUMNS,
} from "../financials";

describe("zeroIfReturned", () => {
  it("retorna 0 quando isReturned=true", () => {
    expect(zeroIfReturned(1234, true)).toBe(0);
  });
  it("retorna o valor original quando isReturned=false", () => {
    expect(zeroIfReturned(1234, false)).toBe(1234);
  });
  it("preserva 0 quando isReturned=false (não vira outro valor)", () => {
    expect(zeroIfReturned(0, false)).toBe(0);
  });
  it("preserva valor negativo quando isReturned=false", () => {
    expect(zeroIfReturned(-500, false)).toBe(-500);
  });
});

describe("computeCupomCents", () => {
  const baseFin = {
    productsRevenue: 10000,
    shippingRevenue: 2000,
    shippingFee: -3000,
    platformFee: -1500,
    discount: 500,
    total: 8000,
  };

  it("retorna 0 quando devolvido", () => {
    expect(computeCupomCents(baseFin, true)).toBe(0);
  });

  it("retorna 0 quando total == soma (sem gap)", () => {
    // gap = total - (productsRevenue + shippingRevenue + platformFee + shippingFee) - discount
    const finSum = baseFin.productsRevenue + baseFin.shippingRevenue + baseFin.platformFee + baseFin.shippingFee;
    const fin = { ...baseFin, total: finSum + baseFin.discount };
    expect(computeCupomCents(fin, false)).toBe(0);
  });

  it("retorna 0 quando total > soma (gap positivo, sem cupom)", () => {
    const fin = { ...baseFin, total: 99999 };
    expect(computeCupomCents(fin, false)).toBe(0);
  });

  it("retorna -gap (positivo) quando total < soma (cupom = desconto implícito)", () => {
    const fin = { ...baseFin, total: 5000 };
    const finSum = fin.productsRevenue + fin.shippingRevenue + fin.platformFee + fin.shippingFee;
    const expectedGap = fin.total - finSum - fin.discount;
    expect(computeCupomCents(fin, false)).toBe(-expectedGap);
  });
});

describe("normalizeFinancialsForStorage", () => {
  it("zera tudo quando isReturned=true", () => {
    const fin = {
      productsRevenue: 10000,
      shippingRevenue: 2000,
      shippingFee: -3000,
      platformFee: -1500,
      discount: 500,
      total: 8000,
    };
    const result = normalizeFinancialsForStorage(fin, true, 200);
    expect(result.productsAmountCents).toBe(0);
    expect(result.shippingTotalCents).toBe(0);
    expect(result.shippingCustomerCents).toBe(0);
    expect(result.platformFeeCents).toBe(0);
    expect(result.discountCents).toBe(0);
    expect(result.amountReceivedCents).toBe(0);
    expect(result.packagingCents).toBe(0);
  });

  it("mantém valores e usa Math.abs em shippingFee/plataformFee/discount quando não devolvido", () => {
    const fin = {
      productsRevenue: 10000,
      shippingRevenue: 2000,
      shippingFee: -3000,
      platformFee: -1500,
      discount: -500,
      total: 8000,
    };
    const result = normalizeFinancialsForStorage(fin, false, 200);
    expect(result.productsAmountCents).toBe(10000);
    expect(result.shippingTotalCents).toBe(3000);
    expect(result.shippingCustomerCents).toBe(2000);
    expect(result.platformFeeCents).toBe(1500);
    expect(result.discountCents).toBe(500);
    expect(result.amountReceivedCents).toBe(8000);
    expect(result.packagingCents).toBe(200);
  });

  it("calcula otherCostsCents = cupom quando há gap negativo", () => {
    const fin = {
      productsRevenue: 10000,
      shippingRevenue: 0,
      shippingFee: 0,
      platformFee: 0,
      discount: 0,
      total: 5000,
    };
    const result = normalizeFinancialsForStorage(fin, false, 0);
    expect(result.otherCostsCents).toBe(5000);
  });
});

describe("expectedFinancialsFor", () => {
  it("retorna zeros quando devolvido", () => {
    const fin = {
      productsRevenue: 10000,
      shippingRevenue: 2000,
      shippingFee: -3000,
      platformFee: -1500,
      discount: 500,
      total: 8000,
    };
    const result = expectedFinancialsFor(fin, true, 200);
    expect(result.products).toBe(0);
    expect(result.shippingTotal).toBe(0);
    expect(result.shippingCustomer).toBe(0);
    expect(result.fee).toBe(0);
    expect(result.discount).toBe(0);
    expect(result.cupom).toBe(0);
    expect(result.amountReceived).toBe(0);
    expect(result.packaging).toBe(0);
  });

  it("preserva embalagem existente quando não devolvido", () => {
    const fin = {
      productsRevenue: 10000,
      shippingRevenue: 0,
      shippingFee: 0,
      platformFee: 0,
      discount: 0,
      total: 10000,
    };
    const result = expectedFinancialsFor(fin, false, 250);
    expect(result.packaging).toBe(250);
  });

  it("igual à normalizeFinancialsForStorage quando embalagem=0", () => {
    const fin = {
      productsRevenue: 10000,
      shippingRevenue: 2000,
      shippingFee: -3000,
      platformFee: -1500,
      discount: 500,
      total: 5000,
    };
    const expected = expectedFinancialsFor(fin, false, 0);
    const norm = normalizeFinancialsForStorage(fin, false, 0);
    expect(expected.products).toBe(norm.productsAmountCents);
    expect(expected.shippingTotal).toBe(norm.shippingTotalCents);
    expect(expected.shippingCustomer).toBe(norm.shippingCustomerCents);
    expect(expected.fee).toBe(norm.platformFeeCents);
    expect(expected.discount).toBe(norm.discountCents);
    expect(expected.cupom).toBe(norm.otherCostsCents);
    expect(expected.amountReceived).toBe(norm.amountReceivedCents);
  });
});

describe("zeroFinancialsSetClause", () => {
  it("gera SQL válido cobrindo todas as colunas", () => {
    const sql = zeroFinancialsSetClause();
    for (const col of ORDER_FINANCIALS_COLUMNS) {
      expect(sql).toContain(`${col} = 0`);
    }
  });

  it("gera exatamente 9 colunas (consistência com a tabela)", () => {
    const sql = zeroFinancialsSetClause();
    const matches = sql.match(/=\s*0/g) ?? [];
    expect(matches.length).toBe(ORDER_FINANCIALS_COLUMNS.length);
  });
});

describe("matchProductByTitle", () => {
  const products = [
    { id: 1, name: "Porta-copos geometricos", sku: "PC-GEO", costCents: 500 },
    { id: 2, name: "Vaso suculenta", sku: "VAS-SUC", costCents: 800 },
    { id: 3, name: "Suporte para celular articulado", sku: "SUP-CEL-ART", costCents: 1200 },
    { id: 4, name: "Chaveiro coração", sku: "CHA-COR", costCents: 150 },
  ];

  it("faz match exato quando título do ML é praticamente o nome do produto", () => {
    expect(matchProductByTitle(products, "Porta Copos Geométricos")?.id).toBe(1);
  });

  it("ignora stopwords comuns (de, da, do, para, com)", () => {
    expect(matchProductByTitle(products, "Suporte de Celular com Articulação")?.id).toBe(3);
  });

  it("ignora acentos via normalize", () => {
    expect(matchProductByTitle(products, "vaso suculenta")?.id).toBe(2);
  });

  it("retorna null quando não há match", () => {
    expect(matchProductByTitle(products, "Caneca personalizada")).toBeNull();
  });

  it("retorna null quando título fica vazio após remover stopwords", () => {
    expect(matchProductByTitle(products, "de da do com")).toBeNull();
  });

  it("retorna null quando nenhuma keyword aparece no nome", () => {
    expect(matchProductByTitle(products, "Borracha escolar")).toBeNull();
  });

  it("prefere match mais longo em caso de empate", () => {
    const empate = [
      { id: 10, name: "Vaso", sku: "V1", costCents: 100 },
      { id: 11, name: "Vaso Decorativo Grande Cerâmica", sku: "V2", costCents: 500 },
    ];
    expect(matchProductByTitle(empate, "Vaso Decorativo Cerâmica")?.id).toBe(11);
  });

  it("exige match perfeito quando só há 2 keywords", () => {
    const produtos = [
      { id: 1, name: "Caneca Branca", sku: "C1", costCents: 100 },
      { id: 2, name: "Caneca Branca Cerâmica", sku: "C2", costCents: 200 },
    ];
    expect(matchProductByTitle(produtos, "Caneca Branca")?.id).toBe(2);
  });

  it("funciona com lista vazia", () => {
    expect(matchProductByTitle([], "qualquer coisa")).toBeNull();
  });
});
