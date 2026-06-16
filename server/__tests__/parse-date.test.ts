import { describe, it, expect } from "vitest";
import { parseExcelDate } from "../xlsxParser.js";

describe("parseExcelDate", () => {
  it("parse data ISO", () => {
    expect(parseExcelDate("2026-06-15")).toBe("2026-06-15");
  });

  it("parse data ISO com T", () => {
    expect(parseExcelDate("2026-06-15T10:30:00")).toBe("2026-06-15");
  });

  it("parse data BR (dd/mm/aaaa)", () => {
    expect(parseExcelDate("15/06/2026")).toBe("2026-06-15");
  });

  it("parse data BR longa sem horário", () => {
    expect(parseExcelDate("15 de junho de 2026")).toBe("2026-06-15");
  });

  it("parse data BR longa com horário sem pipe", () => {
    expect(parseExcelDate("12 de junho de 2026 17:48 hs")).toBe("2026-06-12");
  });

  it("parse data BR longa com horário sem pipe e sem hs", () => {
    expect(parseExcelDate("12 de junho de 2026 17:48")).toBe("2026-06-12");
  });

  it("parse data BR longa com horário com pipe", () => {
    expect(parseExcelDate("12 de junho de 2026 | 17:48")).toBe("2026-06-12");
  });

  it("parse data BR longa sem ano", () => {
    expect(parseExcelDate("12 de junho 17:48 hs")).toBe("2026-06-12");
  });

  it("parse data BR longa sem ano nem horário", () => {
    expect(parseExcelDate("1 de janeiro")).toBe("2026-01-01");
  });

  it("retorna raw string quando não reconhece", () => {
    expect(parseExcelDate("garbage")).toBe("garbage");
  });

  it("retorna vazio para null/empty", () => {
    expect(parseExcelDate("")).toBe("");
  });

  it("parse Date object", () => {
    expect(parseExcelDate(new Date("2026-06-15T10:00:00Z"))).toBe("2026-06-15");
  });
});
