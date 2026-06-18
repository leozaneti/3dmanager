import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { hashPassword, verifyPassword, createSession, deleteSession, validateSession } from "../auth.js";

export default function registerAuthRoutes(app: FastifyInstance, AUTH_ENABLED: boolean) {
  app.post("/api/auth/setup", async (request, reply) => {
    if (!AUTH_ENABLED) { reply.code(404).send({ error: "Auth desabilitada" }); return; }
    const existing = db.prepare("select value from settings where key = 'admin_password_hash'").get() as { value: string } | undefined;
    if (existing?.value) {
      reply.code(409);
      return { error: "Senha já configurada" };
    }
    const { password } = z.object({ password: z.string().min(4).max(128) }).parse(request.body);
    const hash = hashPassword(password);
    db.prepare("insert or replace into settings (key, value) values ('admin_password_hash', ?)").run(hash);
    db.log("create", "auth", 0, "Senha administrativa configurada");
    const token = createSession();
    reply.header("Set-Cookie", `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
    return { ok: true };
  });

  app.get("/api/auth/status", async (request, reply) => {
    if (!AUTH_ENABLED) return { enabled: false, configured: false, authenticated: true };
    const existing = db.prepare("select value from settings where key = 'admin_password_hash'").get() as { value: string } | undefined;
    const configured = !!existing?.value;
    if (!configured) return { enabled: true, configured: false, authenticated: false };
    const cookie = request.headers.cookie ?? "";
    const match = cookie.match(/\bsession=([a-f0-9]+)/);
    const authenticated = match ? validateSession(match[1]) : false;
    return { enabled: true, configured: true, authenticated };
  });

  app.post("/api/auth/login", {
    config: { rateLimit: { max: 5, timeWindow: "15 minutes" } }
  }, async (request, reply) => {
    if (!AUTH_ENABLED) { reply.code(404).send({ error: "Auth desabilitada" }); return; }
    const { password } = z.object({ password: z.string().min(1) }).parse(request.body);
    const stored = db.prepare("select value from settings where key = 'admin_password_hash'").get() as { value: string } | undefined;
    if (!stored?.value) {
      reply.code(400);
      return { error: "Nenhuma senha configurada. Acesse /setup primeiro." };
    }
    if (!verifyPassword(password, stored.value)) {
      reply.code(401);
      return { error: "Senha incorreta" };
    }
    const token = createSession();
    reply.header("Set-Cookie", `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
    return { ok: true };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    if (!AUTH_ENABLED) { reply.code(404).send({ error: "Auth desabilitada" }); return; }
    const cookie = request.headers.cookie ?? "";
    const match = cookie.match(/\bsession=([a-f0-9]+)/);
    if (match) deleteSession(match[1]);
    reply.header("Set-Cookie", "session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
    return { ok: true };
  });
}
