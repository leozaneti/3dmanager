import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { all, get } from "./helpers.js";

export default function registerTodoRoutes(app: FastifyInstance) {
  const todoColumnSchema = z.object({
    name: z.string().min(1).max(40),
    position: z.coerce.number().int().min(0).default(0),
    isDoneColumn: z.coerce.boolean().default(false)
  });

  const todoSchema = z.object({
    columnId: z.coerce.number().int().positive(),
    title: z.string().min(1).max(200),
    notes: z.string().max(2000).optional().default(""),
    position: z.coerce.number().int().min(0).default(0),
    priority: z.coerce.number().int().min(0).max(2).default(0),
    dueDate: z.string().nullable().optional()
  });

  const todoMoveSchema = z.object({
    columnId: z.coerce.number().int().positive(),
    position: z.coerce.number().int().min(0)
  });

  app.get("/api/todo-board", (request) => {
    const query = request.query as Record<string, unknown>;
    const showDone = query.showDone !== "0";

    const columns = all<{ id: number; name: string; position: number; is_done_column: number }>(
      "select id, name, position, is_done_column from todo_columns where active = 1 order by position, id"
    );

    const allTodos = all<{
      id: number; column_id: number; title: string; notes: string;
      position: number; priority: number; due_date: string; done_at: string;
    }>(
      `select id, column_id, title, notes, position, priority, due_date, done_at
       from todos order by position`
    );

    const board = columns.map((col) => {
      const isDone = col.is_done_column === 1;
      let cards = allTodos.filter((t) => t.column_id === col.id);
      if (isDone && !showDone) {
        cards = [];
      }
      return {
        id: col.id,
        name: col.name,
        isDoneColumn: isDone,
        cards: cards.map((t) => ({
          id: t.id,
          title: t.title,
          notes: t.notes || "",
          priority: t.priority,
          dueDate: t.due_date || null,
          doneAt: t.done_at || null,
          position: t.position,
        })),
      };
    });

    return board;
  });

  app.post("/api/todo-columns", async (request, reply) => {
    const data = todoColumnSchema.parse(request.body);
    const maxPos = (get("select coalesce(max(position), -1) as m from todo_columns") as any)?.m ?? -1;
    const position = maxPos + 1;
    const result = db.prepare(
      "insert into todo_columns (name, position, is_done_column) values (?, ?, ?)"
    ).run(data.name, position, data.isDoneColumn ? 1 : 0);
    db.log("create", "todo_column", Number(result.lastInsertRowid), `Coluna "${data.name}" criada`);
    reply.code(201);
    return { id: result.lastInsertRowid, position };
  });

  app.put("/api/todo-columns/:id", async (request, reply) => {
    const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
    const existing = get("select id from todo_columns where id = ?", [id]);
    if (!existing) { reply.code(404); return { error: "Coluna nao encontrada" }; }
    const data = todoColumnSchema.partial().parse(request.body);
    db.prepare(
      "update todo_columns set name = coalesce(?, name), position = coalesce(?, position), is_done_column = coalesce(?, is_done_column) where id = ?"
    ).run(data.name ?? null, data.position ?? null, data.isDoneColumn !== undefined ? (data.isDoneColumn ? 1 : 0) : null, id);
    db.log("update", "todo_column", id, `Coluna atualizada`);
    return { ok: true };
  });

  app.delete("/api/todo-columns/:id", async (request, reply) => {
    const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
    const cardCount = (get("select count(*) as c from todos where column_id = ?", [id]) as any)?.c ?? 0;
    if (cardCount > 0) {
      reply.code(409);
      return { error: "Nao e possivel excluir coluna com cards existentes." };
    }
    const col = get("select name from todo_columns where id = ?", [id]) as any;
    db.prepare("delete from todo_columns where id = ?").run(id);
    db.log("delete", "todo_column", id, `Coluna "${col?.name ?? "#" + id}" excluida`);
    return { ok: true };
  });

  app.post("/api/todos", async (request, reply) => {
    const data = todoSchema.parse(request.body);
    const maxPos = (get("select coalesce(max(position), -1) as m from todos where column_id = ?", [data.columnId]) as any)?.m ?? -1;
    const position = maxPos + 1;
    const result = db.prepare(
      "insert into todos (column_id, title, notes, position, priority, due_date) values (?, ?, ?, ?, ?, ?)"
    ).run(data.columnId, data.title, data.notes, position, data.priority, data.dueDate ?? null);
    db.log("create", "todo", Number(result.lastInsertRowid), `Card "${data.title}" criado`);
    reply.code(201);
    return { id: result.lastInsertRowid, position };
  });

  app.put("/api/todos/:id", async (request, reply) => {
    const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
    const existing = get("select id from todos where id = ?", [id]);
    if (!existing) { reply.code(404); return { error: "Card nao encontrado" }; }
    const data = todoSchema.partial().parse(request.body);
    db.prepare(
      `update todos set
        column_id = coalesce(?, column_id),
        title = coalesce(?, title),
        notes = coalesce(?, notes),
        position = coalesce(?, position),
        priority = coalesce(?, priority),
        due_date = coalesce(?, due_date),
        updated_at = current_timestamp
       where id = ?`
    ).run(
      data.columnId ?? null, data.title ?? null, data.notes ?? null,
      data.position ?? null, data.priority ?? null, data.dueDate ?? null,
      id
    );
    db.log("update", "todo", id, `Card atualizado`);
    return { ok: true };
  });

  app.put("/api/todos/:id/move", async (request, reply) => {
    const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
    const existing = get("select id from todos where id = ?", [id]);
    if (!existing) { reply.code(404); return { error: "Card nao encontrado" }; }
    const data = todoMoveSchema.parse(request.body);
    const column = get("select is_done_column from todo_columns where id = ?", [data.columnId]) as any;
    const isDone = column?.is_done_column === 1;
    db.prepare(
      "update todos set column_id = ?, position = ?, done_at = ?, updated_at = current_timestamp where id = ?"
    ).run(data.columnId, data.position, isDone ? new Date().toISOString() : null, id);
    db.log("move", "todo", id, isDone ? `Card movido para coluna de concluidos` : `Card movido`);
    return { ok: true };
  });

  app.delete("/api/todos/:id", async (request) => {
    const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id);
    const card = get("select title from todos where id = ?", [id]) as any;
    db.prepare("delete from todos where id = ?").run(id);
    db.log("delete", "todo", id, `Card "${card?.title ?? "#" + id}" excluido`);
    return { ok: true };
  });
}
