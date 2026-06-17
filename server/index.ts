import fs from "node:fs";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { migrate } from "./db.js";
import { clearExpiredSessions } from "./auth.js";
import { authMiddleware } from "./middleware/auth.js";
import { loadStatuses } from "./statusConfig.js";

import registerAuthRoutes from "./routes/auth.js";
import registerAdminRoutes from "./routes/admin.js";
import registerProductRoutes from "./routes/products.js";
import registerCustomerRoutes from "./routes/customers.js";
import registerOrderRoutes from "./routes/orders.js";
import registerImportRoutes from "./routes/imports.js";
import registerDashboardRoutes from "./routes/dashboard.js";
import registerTodoRoutes from "./routes/todos.js";
import registerFinanceRoutes from "./routes/finance.js";
import registerBackupRoutes from "./routes/backups.js";

const app = Fastify({ logger: true });
const AUTH_ENABLED = process.env.AUTH_ENABLED === "true";

app.setErrorHandler((error, request, reply) => {
  console.error("UNHANDLED ERROR:", error.message, error.stack?.split("\n")[1]);
  reply.status(error.statusCode ?? 500).send({ error: error.message });
});

await app.register(cors, { origin: true });
await app.register(multipart, {
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }
});
await app.register(rateLimit, {
  global: false,
  max: 300,
  timeWindow: "1 minute"
});

const frontendDir = path.resolve("dist");
if (fs.existsSync(frontendDir)) {
  await app.register(fastifyStatic, {
    root: frontendDir,
    prefix: "/",
    wildcard: false
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
      reply.status(404).send({ error: "Not Found" });
    } else {
      reply.sendFile("index.html");
    }
  });
}

migrate();
loadStatuses();

clearExpiredSessions();
setInterval(clearExpiredSessions, 60 * 60 * 1000);

if (AUTH_ENABLED) {
  app.addHook("preHandler", authMiddleware);
}

registerAuthRoutes(app, AUTH_ENABLED);
registerAdminRoutes(app);
registerProductRoutes(app);
registerCustomerRoutes(app);
registerOrderRoutes(app);
registerImportRoutes(app);
registerDashboardRoutes(app);
registerTodoRoutes(app);
registerFinanceRoutes(app);
registerBackupRoutes(app);

app.listen({ port: 3333, host: "127.0.0.1" });
