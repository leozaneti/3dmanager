import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { deleteDb } from "./helpers/setup.js";

let getStatusId: (name: string, fallback?: number) => number;
let getStatusName: (id: number) => string;
let isValidStatusId: (id: number) => boolean;
let isDevolvido: (id: number) => boolean;
let resolveTransitions: (id: number) => number[];

beforeAll(async () => {
  deleteDb();
  const dbMod = await import("../db.js");
  dbMod.migrate();
  const mod = await import("../statusConfig.js");
  mod.loadStatuses();
  getStatusId = mod.getStatusId;
  getStatusName = mod.getStatusName;
  isValidStatusId = mod.isValidStatusId;
  isDevolvido = mod.isDevolvido;
  resolveTransitions = mod.resolveTransitions;
});

afterAll(() => {
  deleteDb();
});

describe("statusConfig", () => {
  describe("getStatusId", () => {
    it("retorna ID para nome existente", () => {
      expect(getStatusId("novo")).toBeGreaterThanOrEqual(1);
    });

    it("retorna fallback (default 1) para nome inexistente", () => {
      expect(getStatusId("inexistente")).toBe(1);
    });

    it("aceita fallback customizado", () => {
      expect(getStatusId("inexistente", 0)).toBe(0);
    });
  });

  describe("getStatusName", () => {
    it("retorna nome para ID existente", () => {
      expect(getStatusName(1).toLowerCase()).toBe("novo");
    });

    it("retorna string do ID para ID inexistente", () => {
      expect(getStatusName(99)).toBe("99");
    });
  });

  describe("isValidStatusId", () => {
    it("retorna true para status existente", () => {
      expect(isValidStatusId(1)).toBe(true);
    });

    it("retorna false para status inexistente", () => {
      expect(isValidStatusId(99)).toBe(false);
    });
  });

  describe("isDevolvido", () => {
    it("retorna true para ID do status Devolvido", () => {
      const devId = getStatusId("devolvido");
      expect(isDevolvido(devId)).toBe(true);
    });

    it("retorna false para outro status", () => {
      expect(isDevolvido(1)).toBe(false);
    });
  });

  describe("resolveTransitions", () => {
    it("Novo → Enviado, Cancelado, Devolvido", () => {
      const novoId = getStatusId("novo");
      const enviadoId = getStatusId("enviado");
      const canceladoId = getStatusId("cancelado");
      const devolvidoId = getStatusId("devolvido");
      expect(resolveTransitions(novoId)).toEqual(
        expect.arrayContaining([enviadoId, canceladoId, devolvidoId])
      );
    });

    it("Devolvido é terminal (nenhuma transição)", () => {
      const devId = getStatusId("devolvido");
      expect(resolveTransitions(devId)).toEqual([]);
    });

    it("ID inexistente retorna array vazio", () => {
      expect(resolveTransitions(99)).toEqual([]);
    });
  });
});
