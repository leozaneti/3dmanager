import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import net from "node:net";
import path from "node:path";

const scriptPath = path.resolve("server/scripts/wait-for-port.mjs");

describe("wait-for-port", () => {
  it("syntax valida", () => {
    execFileSync("node", ["--check", scriptPath], { encoding: "utf8" });
  });

  it("timeout quando porta nao esta ouvindo", () => {
    const start = Date.now();
    let didThrow = false;
    try {
      /* Usa porta dinâmica (3343) para garantir que ninguém esteja ouvindo.
         Sem isso, se outro teste deixou server na 3333, o script daria exit 0. */
      execFileSync("node", [scriptPath], {
        encoding: "utf8",
        timeout: 3000,
        env: { ...process.env, WAIT_TIMEOUT: "2000", PORT: "3343" },
      });
    } catch {
      didThrow = true;
    }
    const elapsed = Date.now() - start;
    expect(didThrow, "deveria ter lancado erro (timeout ou exit 1)").toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(1500);
  });

  it("retorna 0 quando porta esta ouvindo", () => {
    return new Promise<void>((resolve, reject) => {
      /* Usa porta dinâmica (0 = deixa o OS escolher) para evitar conflito
         entre runs anteriores que deixaram server preso. Passamos PORT pelo env. */
      const testPort = 3334 + Math.floor(Math.random() * 100);
      const localServer = net.createServer();
      const cleanup = () => {
        if (localServer.listening) localServer.close();
      };
      localServer.on("error", (e) => { cleanup(); reject(e); });
      localServer.listen(testPort, "127.0.0.1", () => {
        try {
          const result = execFileSync("node", [scriptPath], {
            encoding: "utf8",
            timeout: 3000,
            env: { ...process.env, WAIT_TIMEOUT: "2000", PORT: String(testPort) },
          });
          expect(result).toBe("");
          cleanup();
          resolve();
        } catch (e: any) {
          cleanup();
          reject(new Error(`Esperava sucesso, mas falhou: ${e.message}`));
        }
      });
    });
  });
});
