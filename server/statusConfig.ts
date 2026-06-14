import { db } from "./db.js";

/**
 * Transições de status definidas por NOME (não por ID numérico).
 * Regras de negócio independentes do banco.
 */
export const STATUS_TRANSITIONS: Record<string, string[]> = {
  novo: ["enviado", "cancelado", "devolvido"],
  enviado: ["entregue", "cancelado", "devolvido"],
  entregue: ["devolvido"],
  cancelado: [],
  devolvido: [],
};

let _loaded = false;
let STATUS_IDS: Record<string, number> = {};
let STATUS_NAMES: Record<number, string> = {};

export function loadStatuses() {
  const rows = db.prepare("select id, name from order_statuses where active = 1").all() as { id: number; name: string }[];
  STATUS_IDS = Object.fromEntries(rows.map(s => [s.name.toLowerCase(), s.id]));
  STATUS_NAMES = Object.fromEntries(rows.map(s => [s.id, s.name]));
  _loaded = true;
}

function ensureLoaded() {
  if (!_loaded) loadStatuses();
}

export function getStatusId(name: string, fallback = 1): number {
  ensureLoaded();
  return STATUS_IDS[name.toLowerCase()] ?? fallback;
}

export function getStatusName(id: number): string {
  ensureLoaded();
  return STATUS_NAMES[id] ?? String(id);
}

export function isValidStatusId(id: number): boolean {
  ensureLoaded();
  return id in STATUS_NAMES;
}

export function isDevolvido(id: number): boolean {
  return id === getStatusId("devolvido");
}

export function resolveTransitions(currentId: number): number[] {
  ensureLoaded();
  const currentName = getStatusName(currentId).toLowerCase();
  const allowedNames = STATUS_TRANSITIONS[currentName];
  if (!allowedNames) return [];
  return allowedNames.map(name => getStatusId(name));
}
