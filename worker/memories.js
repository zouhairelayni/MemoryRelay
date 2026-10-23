// Memory storage. The agent-facing functions are protected by the rules tag; the owner functions are not.
import { MAX_LEN } from "./constants.js";
import { brief, isProtected, newId, now, runAll, similar } from "./util.js";

export async function remember(env, a) {
  const text = String(a.text || "").trim();
  if (!text) return "nothing saved: empty text";
  if (text.length > MAX_LEN) return `not saved: over ${MAX_LEN} chars, split it into smaller facts`;
  if (isProtected(a.tags)) return "not saved: the tag rules is reserved for owner rules";
  const { results } = await env.DB.prepare("SELECT id, text FROM memories").all();
  const dup = results.find((m) => similar(m.text, text));
  if (dup) return `duplicate of ${dup.id}, not saved`;
  const id = newId(), t = now();
  await env.DB.prepare(
    "INSERT INTO memories (id, text, tags, source, created, updated, history) VALUES (?, ?, ?, ?, ?, ?, '[]')"
  ).bind(id, text, String(a.tags || "").trim().toLowerCase(), String(a.source || "claude"), t, t).run();
  return `saved ${id}`;
}

export async function search(env, a) {
  const limit = Math.min(Math.max(Number(a.limit) || 5, 1), 20);
  const words = String(a.query || "").toLowerCase().split(" ").filter(Boolean);
  const where = words.length ? "WHERE " + words.map(() => "(text || ' ' || tags) LIKE ?").join(" AND ") : "";
  const params = words.map((w) => `%${w}%`);
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM memories ${where}`).bind(...params).first();
  const { results } = await env.DB.prepare(
    `SELECT id, text, tags, created FROM memories ${where} ORDER BY created DESC, rowid DESC LIMIT ?`
  ).bind(...params, limit).all();
  return { total: total.n, results: results.map(brief) };
}

export async function recent(env, a) {
  const n = Math.min(Math.max(Number(a.n) || 5, 1), 20);
  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM memories").first();
  const { results } = await env.DB.prepare(
    "SELECT id, text, tags, created FROM memories ORDER BY created DESC, rowid DESC LIMIT ?"
  ).bind(n).all();
  return { total: total.n, results: results.map(brief) };
}

export async function updateMemory(env, a) {
  const row = await env.DB.prepare("SELECT * FROM memories WHERE id = ?").bind(String(a.memory_id)).first();
  if (!row) return "not found";
  if (isProtected(row.tags)) return "protected: rules memories cannot be changed through the connector";
  let text = row.text, tags = row.tags;
  const history = JSON.parse(row.history || "[]");
  const newText = String(a.text || "").trim();
  if (newText) {
    if (newText.length > MAX_LEN) return `not updated: over ${MAX_LEN} chars`;
    history.push({ text: row.text, time: row.updated });
    text = newText;
  }
  if (a.tags && String(a.tags).trim()) tags = String(a.tags).trim().toLowerCase();
  await env.DB.prepare("UPDATE memories SET text = ?, tags = ?, updated = ?, history = ? WHERE id = ?")
    .bind(text, tags, now(), JSON.stringify(history), row.id).run();
  return `updated ${row.id}`;
}

export const cleanTags = (s) => String(s || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean).join(",");

// Dashboard only (the owner). Rule toggle on: the tag is exactly "rules", which agents can never
// change or delete. Rule toggle off: free tags, never "rules", at most 3.
export function ownerTags(rule, rawTags) {
  if (rule) return { tags: "rules" };
  const tags = cleanTags(rawTags);
  if (isProtected(tags)) return { error: "the tag rules is only set with the Rule toggle" };
  if (tags && tags.split(",").length > 3) return { error: "use at most 3 tags" };
  return { tags };
}

export async function addMemory(env, b) {
  const text = String(b.text || "").trim();
  if (!text) return { error: "write the memory first" };
  if (text.length > MAX_LEN) return { error: `over ${MAX_LEN} characters` };
  const rule = b.rule === true;
  const t = ownerTags(rule, b.tags);
  if (t.error) return t;
  const { results } = await env.DB.prepare("SELECT id, text FROM memories").all();
  const dup = results.find((m) => similar(m.text, text));
  if (dup) return { error: `a similar memory already exists (${dup.id})` };
  const id = newId(), when = now();
  await env.DB.prepare(
    "INSERT INTO memories (id, text, tags, source, created, updated, history) VALUES (?, ?, ?, ?, ?, ?, '[]')"
  ).bind(id, text, t.tags, rule ? "owner" : "dashboard", when, when).run();
  return { ok: true, id, rule };
}

export async function editMemory(env, id, b) {
  const row = await env.DB.prepare("SELECT * FROM memories WHERE id = ?").bind(String(id)).first();
  if (!row) return { error: "memory not found" };
  const text = String(b.text || "").trim();
  if (!text) return { error: "text cannot be empty" };
  if (text.length > MAX_LEN) return { error: `over ${MAX_LEN} characters` };
  const rule = typeof b.rule === "boolean" ? b.rule : isProtected(row.tags);
  let tags = row.tags;
  if (rule || typeof b.tags === "string") {
    const t = ownerTags(rule, b.tags);
    if (t.error) return t;
    tags = t.tags;
  }
  if (!rule && isProtected(tags)) tags = "";
  const history = JSON.parse(row.history || "[]");
  if (text !== row.text) history.push({ text: row.text, time: row.updated });
  await env.DB.prepare("UPDATE memories SET text = ?, tags = ?, updated = ?, history = ? WHERE id = ?")
    .bind(text, tags, now(), JSON.stringify(history), row.id).run();
  return { ok: true, id: row.id, rule };
}

export async function forget(env, a) {
  const row = await env.DB.prepare("SELECT tags FROM memories WHERE id = ?").bind(String(a.memory_id)).first();
  if (!row) return "not found";
  if (isProtected(row.tags)) return "protected: rules memories cannot be deleted through the connector";
  await env.DB.prepare("DELETE FROM memories WHERE id = ?").bind(String(a.memory_id)).run();
  return "deleted";
}

// ---- owner (dashboard) helpers: list, export, import ----

export async function listMemories(env, q) {
  const words = String(q || "").toLowerCase().split(" ").filter(Boolean);
  const where = words.length ? "WHERE " + words.map(() => "(text || ' ' || tags) LIKE ?").join(" AND ") : "";
  const { results } = await env.DB.prepare(
    `SELECT id, text, tags, created AS time FROM memories ${where} ORDER BY created DESC, rowid DESC LIMIT 500`
  ).bind(...words.map((w) => `%${w}%`)).all();
  return { count: results.length, items: results };
}

export async function deleteMemory(env, id) {
  const r = await env.DB.prepare("DELETE FROM memories WHERE id = ?").bind(String(id)).run();
  return { deleted: r.meta.changes };
}

export async function exportMemories(env) {
  const { results } = await env.DB.prepare("SELECT * FROM memories ORDER BY created, rowid").all();
  return results;
}

export async function importMemories(env, incoming, mode) {
  if (!Array.isArray(incoming)) return { error: "expected a list of memories" };
  const rows = incoming.filter((x) => x && typeof x.text === "string" && x.text.trim() && !isProtected(x.tags)).map((x) => ({
    id: String(x.id || newId()),
    text: x.text.trim().slice(0, MAX_LEN),
    tags: String(x.tags || "").toLowerCase(),
    source: String(x.source || "import"),
    created: String(x.created || x.time || now()),
    updated: String(x.updated || x.time || now()),
    history: typeof x.history === "string" ? x.history : JSON.stringify(Array.isArray(x.history) ? x.history : []),
  }));
  const stmts = [];
  if (mode === "replace") stmts.push(env.DB.prepare("DELETE FROM memories WHERE tags NOT LIKE '%rules%'"));
  for (const r of rows) {
    stmts.push(env.DB.prepare(
      "INSERT OR IGNORE INTO memories (id, text, tags, source, created, updated, history) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(r.id, r.text, r.tags, r.source, r.created, r.updated, r.history));
  }
  await runAll(env, stmts);
  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM memories").first();
  return { imported: rows.length, total: total.n };
}
