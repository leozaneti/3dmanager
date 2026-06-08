import type { FastifyRequest, FastifyReply } from "fastify";
import { validateSession } from "../auth.js";

const PUBLIC_PREFIXES = ["/api/auth/", "/api/health"];

export async function authMiddleware(req: FastifyRequest, reply: FastifyReply) {
  const url = req.url;
  if (PUBLIC_PREFIXES.some(p => url.startsWith(p))) return;
  if (!url.startsWith("/api/")) return;

  const cookie = req.headers.cookie ?? "";
  const token = parseSessionToken(cookie);
  if (!token || !validateSession(token)) {
    reply.code(401).send({ error: "Não autenticado. Faça login primeiro." });
  }
}

function parseSessionToken(cookie: string): string | null {
  const match = cookie.match(/\bsession=([a-f0-9]+)/);
  return match ? match[1] : null;
}
