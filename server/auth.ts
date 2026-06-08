import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const SESSIONS = new Map<string, { createdAt: number; lastSeen: number }>();

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = scryptSync(password, salt, 64);
  const storedBuf = Buffer.from(hash, "hex");
  if (derived.length !== storedBuf.length) return false;
  return timingSafeEqual(derived, storedBuf);
}

export function createSession(): string {
  const token = randomBytes(32).toString("hex");
  SESSIONS.set(token, { createdAt: Date.now(), lastSeen: Date.now() });
  return token;
}

export function validateSession(token: string): boolean {
  const session = SESSIONS.get(token);
  if (!session) return false;
  if (Date.now() - session.lastSeen > SESSION_TTL_MS) {
    SESSIONS.delete(token);
    return false;
  }
  session.lastSeen = Date.now();
  return true;
}

export function deleteSession(token: string): void {
  SESSIONS.delete(token);
}

export function clearExpiredSessions(): void {
  const now = Date.now();
  for (const [key, val] of SESSIONS) {
    if (now - val.lastSeen > SESSION_TTL_MS) SESSIONS.delete(key);
  }
}
