// A tiny D1 stand-in on top of node:sqlite, so the Worker modules can be tested without Cloudflare.
import { DatabaseSync } from "node:sqlite";

export function createD1() {
  const db = new DatabaseSync(":memory:");
  const stmt = (sql, params = []) => ({
    bind: (...p) => stmt(sql, p),
    run: async () => { const r = db.prepare(sql).run(...params); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    first: async () => db.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
  });
  return { db, DB: { prepare: (s) => stmt(s), batch: async (l) => { for (const s of l) await s.run(); } } };
}
