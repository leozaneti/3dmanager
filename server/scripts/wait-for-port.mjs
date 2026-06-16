import net from "node:net";
import process from "node:process";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT) || 3333;
const TIMEOUT_MS = Number(process.env.WAIT_TIMEOUT) || 60_000;
const INTERVAL_MS = 300;
const start = Date.now();

function tryConnect() {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(PORT, HOST, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on("error", (err) => {
      sock.destroy();
      reject(err);
    });
    sock.setTimeout(1000);
    sock.on("timeout", () => {
      sock.destroy();
      reject(new Error("timeout"));
    });
  });
}

(async () => {
  while (Date.now() - start < TIMEOUT_MS) {
    try {
      await tryConnect();
      process.exit(0);
    } catch {
      await new Promise((r) => setTimeout(r, INTERVAL_MS));
    }
  }
  console.error("wait-for-port: timeout waiting for server on", PORT);
  process.exit(1);
})();
