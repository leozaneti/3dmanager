import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { all, get, boolRow } from "./helpers.js";

export default function registerAdminRoutes(app: FastifyInstance) {
  const storeSchema = z.object({
    name: z.string().min(1),
    active: z.coerce.boolean().default(true)
  });

  app.get("/api/meta", () => ({
    stores: all("select id, name, active from stores order by name").map(boolRow),
    channels: all("select id, name, active from sales_channels where active = 1 order by name"),
    statuses: all("select id, name, sort_order as sortOrder, is_final as isFinal from order_statuses where active = 1 order by sort_order"),
  }));

  app.get("/api/stores", () => all("select id, name, active from stores order by name").map(boolRow));

  app.post("/api/stores", async (request, reply) => {
    const data = storeSchema.parse(request.body);
    const result = db.prepare("insert into stores (name, active) values (?, ?)").run(data.name, data.active ? 1 : 0);
    db.log("create", "store", Number(result.lastInsertRowid), `Loja "${data.name}" criada`);
    reply.code(201);
    return { id: result.lastInsertRowid };
  });

  app.put("/api/stores/:id", async (request, reply) => {
    const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
    const existing = get("select id from stores where id = ?", [id]);
    if (!existing) {
      reply.code(404);
      return { error: "Loja não encontrada" };
    }
    const data = storeSchema.parse(request.body);
    db.prepare("update stores set name = ?, active = ?, updated_at = current_timestamp where id = ?").run(
      data.name,
      data.active ? 1 : 0,
      id
    );
    db.log("update", "store", id, `Loja "${data.name}" atualizada`);
    return { ok: true };
  });

  app.delete("/api/stores/:id", async (request, reply) => {
    const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
    const existingOrder = get("select 1 from orders where store_id = ? limit 1", [id]);
    if (existingOrder) {
      reply.code(409);
      return { error: "Não é possível excluir loja com pedidos existentes." };
    }
    db.prepare("delete from stores where id = ?").run(id);
    db.log("delete", "store", id, `Loja #${id} excluída`);
    return { ok: true };
  });

  app.get("/api/settings", () => {
    const rows = all<{ key: string; value: string; description: string }>("select key, value, description from settings where key != 'admin_password_hash' and key not like 'schema_%'");
    const order = ["pla_price_per_kg", "energy_cost_per_hour", "machine_value", "machine_lifespan_hours", "maintenance_factor", "error_rate", "packaging_cost"];
    rows.sort((a: any, b: any) => {
      const ia = order.indexOf(a.key);
      const ib = order.indexOf(b.key);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
    return rows.reduce<Record<string, { value: string; description: string }>>((acc, row) => {
      acc[row.key] = { value: row.value, description: row.description };
      return acc;
    }, {});
  });

  app.put("/api/settings", async (request) => {
    const data = request.body as Record<string, { value: string }>;
    const stmt = db.prepare("update settings set value = ?, updated_at = current_timestamp where key = ?");
    for (const [key, val] of Object.entries(data)) {
      stmt.run(val.value, key);
    }
    return { ok: true };
  });

  app.get("/api/audit-log", (request) => {
    const query = request.query as Record<string, unknown>;
    const limit = query.limit ? Number(query.limit) : 50;
    const offset = query.offset ? Number(query.offset) : 0;
    const total = (db.prepare("select count(*) as c from audit_log").get() as any)?.c ?? 0;
    const data = db.getAuditLog(limit, offset);
    return { data, total };
  });
}
