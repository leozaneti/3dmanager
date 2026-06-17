import { z } from "zod";
import { db } from "../db.js";

export function all<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return db.prepare(sql).all(params) as T[];
}

export function get<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return db.prepare(sql).get(params) as T | undefined;
}

export function boolRow<T extends Record<string, unknown>>(row: T) {
  return { ...row, active: Boolean(row.active) };
}

export const cents = z.coerce.number().int().default(0);
export const optionalId = z.coerce.number().int().positive().nullable().optional();
