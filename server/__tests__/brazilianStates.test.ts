import { describe, it, expect } from "vitest";
import { STATE_NAMES, STATES, getStateName, getStateAbbreviation, STATE_NAMESUpper } from "../brazilianStates";

describe("STATE_NAMES", () => {
  it("contém as 27 UFs do Brasil (26 estados + DF)", () => {
    expect(Object.keys(STATE_NAMES)).toHaveLength(27);
  });

  it("SP → São Paulo", () => {
    expect(STATE_NAMES.SP).toBe("São Paulo");
  });

  it("AC → Acre (com acento, não Acre)", () => {
    expect(STATE_NAMES.AC).toBe("Acre");
  });

  it("DF → Distrito Federal", () => {
    expect(STATE_NAMES.DF).toBe("Distrito Federal");
  });
});

describe("STATES", () => {
  it("é readonly array de siglas, na mesma ordem do STATE_NAMES", () => {
    expect(STATES).toEqual(Object.keys(STATE_NAMES));
  });
});

describe("getStateName", () => {
  it("converte UF para nome completo", () => {
    expect(getStateName("SP")).toBe("São Paulo");
  });

  it("é case-insensitive", () => {
    expect(getStateName("sp")).toBe("São Paulo");
    expect(getStateName("Sp")).toBe("São Paulo");
  });

  it("preserva acentos no nome retornado", () => {
    expect(getStateName("AP")).toBe("Amapá");
    expect(getStateName("MA")).toBe("Maranhão");
    expect(getStateName("PR")).toBe("Paraná");
  });

  it("retorna o input se já for nome completo", () => {
    expect(getStateName("São Paulo")).toBe("São Paulo");
    expect(getStateName("Rio de Janeiro")).toBe("Rio de Janeiro");
  });

  it("retorna string vazia para entrada vazia", () => {
    expect(getStateName("")).toBe("");
  });

  it("faz trim antes de processar", () => {
    expect(getStateName("  SP  ")).toBe("São Paulo");
  });
});

describe("getStateAbbreviation", () => {
  it("converte nome completo para sigla", () => {
    expect(getStateAbbreviation("São Paulo")).toBe("SP");
    expect(getStateAbbreviation("Rio de Janeiro")).toBe("RJ");
  });

  it("é case-insensitive para nome com acento", () => {
    expect(getStateAbbreviation("são paulo")).toBe("SP");
  });

  it("retorna string vazia para nome sem acento (limitação conhecida)", () => {
    /* Caso de uso real: usuário pode digitar "SAO PAULO" sem acento e não vamos adivinhar. */
    expect(getStateAbbreviation("SAO PAULO")).toBe("");
  });

  it("retorna a sigla como está se já for sigla", () => {
    expect(getStateAbbreviation("SP")).toBe("SP");
    expect(getStateAbbreviation("sp")).toBe("SP");
  });

  it("retorna string vazia para entrada vazia", () => {
    expect(getStateAbbreviation("")).toBe("");
  });

  it("retorna string vazia para nome não reconhecido", () => {
    expect(getStateAbbreviation("Wakanda")).toBe("");
  });
});

describe("STATE_NAMESUpper", () => {
  it("contém chaves e valores em uppercase (para queries SQL case-insensitive)", () => {
    expect(STATE_NAMESUpper.SP).toBe("SÃO PAULO");
    expect(STATE_NAMESUpper.AC).toBe("ACRE");
    expect(STATE_NAMESUpper.DF).toBe("DISTRITO FEDERAL");
  });

  it("mantém a mesma quantidade de entradas", () => {
    expect(Object.keys(STATE_NAMESUpper)).toHaveLength(27);
  });
});
