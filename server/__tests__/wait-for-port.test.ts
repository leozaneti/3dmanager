import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import net from "node:net";
import path from "node:path";

const scriptPath = path.resolve("server/scripts/wait-for-port.mjs");
const PORT = 3333;

let server: net.Server | null = null;

afterAll(() => {
  if (server) server.close();
});

describe("wait-for-port", () => {
  it("syntax valida", () => {
    execFileSync("node", ["--check", scriptPath], { encoding: "utf8" });
  });

  it("timeout quando porta nao esta ouvindo", () => {
    const start = Date.now();
    try {
      execFileSync("node", [scriptPath], {
        encoding: "utf8",
        timeout: 3000,
        env: { ...process.env, WAIT_TIMEOUT: "2000" },
      });
      expect.fail("deveria ter lancado erro");
    } catch (e: any) {
      expect(e.status).toBe(1);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(1500);
    }
  });

  it("retorna 0 quando porta esta ouvindo", () => {
    return new Promise<void>((resolve, reject) => {
      server = net.createServer();
      server.listen(PORT, "127.0.0.1", () => {
        try {
          const result = execFileSync("node", [scriptPath], {
            encoding: "utf8",
            timeout: 3000,
            env: { ...process.env, WAIT_TIMEOUT: "2000" },
          });
          expect(result).toBe("");
          resolve();
        } catch (e: any) {
          reject(new Error(`Esperava sucesso, mas falhou: ${e.message}`));
        } finally {
          if (server) {
            server.close();
            server = null;
          }
        }
      });
      server.on("error", reject);
    });
  });
});
