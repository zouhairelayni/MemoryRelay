// Memory storage. The agent-facing functions are protected by the rules tag; the owner functions are not.
import { MAX_LEN, MAX_MEMORIES, MAX_TAGS } from "./constants.js";
import { NOT_RULES_SQL, brief, clip, isProtected, newId, now, runAll, safeJson, searchWhere, similar } from "./util.js";

const HISTORY_KEEP = 20;
const DUP_SCAN = 1000;

export const cleanTags = (s) => [...new Set(String(s || "").split(",").map((x) => x.trim().toLowerCase().slice(0, 32)).filter(Boolean))].join(",");

// Tags an agent may set: never "rules" (that would let an agent create or promote protected memories), at most MAX_TAGS.
function agentTags(raw) {
  const tags = cleanTags(raw);
  if (isProtected(tags)) return { error: "the tag rules is reserved for owner rules" };
  if (tags && tags.split(",").length > MAX_TAGS) return { error: `use at most ${MAX_TAGS} tags` };
  return { tags };
}

async function insertMemory(env, text, tags, source) {
  for (let i = 0; i < 3; i++) {
    const id = newId(), t = now();
    try {
      await env.DB.prepare("INSERT INTO memories (id, text, tags, source, created, updated, history) VALUES (?, ?, ?, ?, ?, ?, '[]')")
        .bind(id, text, tags, clip(source, 60), t, t).run();
      return id;
    } catch (e) {
      if (!/UNIQUE|constraint/i.test(String(e && e.message))) throw e; // id clash: try a new id
    }
  }
  throw new Error("could not allocate a memory id");
}

async function findDuplicate(env, text) {
  const { results } = await env.DB.prepare("SELECT id, text FROM memories ORDER BY created DESC, rowid DESC LIMIT ?").bind(DUP_SCAN).all();
  return results.find((m) => similar(m.text, text));
}

// `source` comes from the server (the connection's client name), never from what the agent sends.
export async function remember(env, a, source = "agent") {
  const text = String(a.text || "").trim();
  if (!text) return "nothing saved: empty text";
  if (text.length > MAX_LEN) return `not saved: over ${MAX_LEN} chars, split it into smaller facts`;
  const t = agentTags(a.tags);
  if (t.error) return "not saved: " + t.error;
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM memories").first();
  if (count.n >= MAX_MEMORIES) return `not saved: the memory is full (${MAX_MEMORIES}). Ask the owner to clean it up`;
  const dup = await findDuplicate(env, text);
  if (dup) return `duplicate of ${dup.id}, not saved`;
  return `saved ${await insertMemory(env, text, t.tags, source)}`;
}

export async function search(env, a) {
  const limit = Math.min(Math.max(Number(a.limit) || 5, 1), 20);
  const { where, params } = searchWhere(a.query);
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
  const newText = String(a.text || "").trim();
  const newTags = String(a.tags || "").trim();
  if (!newText && !newTags) return "nothing to update: pass text or tags";
  let text = row.text, tags = row.tags;
  const history = safeJson(row.history, []).slice(-(HISTORY_KEEP - 1));
  if (newText) {
    if (newText.length > MAX_LEN) return `not updated: over ${MAX_LEN} chars`;
    if (newText !== row.text) { history.push({ text: row.text, time: row.updated }); text = newText; }
  }
  if (newTags) {
    const t = agentTags(newTags);
    if (t.error) return "not updated: " + t.error;
    tags = t.tags;
  }
  await env.DB.prepare("UPDATE memories SET text = ?, tags = ?, updated = ?, history = ? WHERE id = ?")
    .bind(text, tags, now(), JSON.stringify(history), row.id).run();
  return `updated ${row.id}`;
}

export async function forget(env, a) {
  const id = String(a.memory_id || "");
  const row = await env.DB.prepare("SELECT tags FROM memories WHERE id = ?").bind(id).first();
  if (!row) return "not found";
  if (isProtected(row.tags)) return "protected: rules memories cannot be deleted through the connector";
  await env.DB.prepare("DELETE FROM memories WHERE id = ?").bind(id).run();
  return "deleted";
}

// Dashboard only (the owner). Rule toggle on: the tag is exactly "rules", which agents can never
// change or delete. Rule toggle off: free tags, never "rules", at most 5.
export function ownerTags(rule, rawTags) {
  if (rule) return { tags: "rules" };
  const tags = cleanTags(rawTags);
  if (isProtected(tags)) return { error: "the tag rules is only set with the Rule toggle" };
  if (tags && tags.split(",").length > MAX_TAGS) return { error: `use at most ${MAX_TAGS} tags` };
  return { tags };
}

export async function addMemory(env, b) {
  const text = String(b.text || "").trim();
  if (!text) return { error: "write the memory first" };
  if (text.length > MAX_LEN) return { error: `over ${MAX_LEN} characters` };
  const rule = b.rule === true;
  const t = ownerTags(rule, b.tags);
  if (t.error) return t;
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM memories").first();
  if (count.n >= MAX_MEMORIES) return { error: `the memory is full (${MAX_MEMORIES}). Delete some first` };
  const dup = await findDuplicate(env, text);
  if (dup) return { error: `a similar memory already exists (${dup.id})` };
  const id = await insertMemory(env, text, t.tags, rule ? "owner" : "dashboard");
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
  const history = safeJson(row.history, []).slice(-(HISTORY_KEEP - 1));
  if (text !== row.text) history.push({ text: row.text, time: row.updated });
  await env.DB.prepare("UPDATE memories SET text = ?, tags = ?, updated = ?, history = ? WHERE id = ?")
    .bind(text, tags, now(), JSON.stringify(history), row.id).run();
  return { ok: true, id: row.id, rule };
}

// ---- owner (dashboard) helpers: list, export, import ----

export async function listMemories(env, q) {
  const { where, params } = searchWhere(q);
  const { results } = await env.DB.prepare(
    `SELECT id, text, tags, created AS time FROM memories ${where} ORDER BY created DESC, rowid DESC LIMIT 500`
  ).bind(...params).all();
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
  if (incoming.length > MAX_MEMORIES) return { error: `too many memories in one file (max ${MAX_MEMORIES})` };
  const rows = incoming
    .filter((x) => x && typeof x === "object" && typeof x.text === "string" && x.text.trim())
    .map((x) => {
      const hist = typeof x.history === "string" ? safeJson(x.history, []) : x.history;
      return {
        id: /^[A-Za-z0-9_-]{1,40}$/.test(String(x.id || "")) ? String(x.id) : newId(),
        text: x.text.trim().slice(0, MAX_LEN),
        tags: cleanTags(x.tags),
        source: clip(x.source || "import", 60),
        created: clip(x.created || x.time || now(), 32),
        updated: clip(x.updated || x.time || now(), 32),
        history: JSON.stringify((Array.isArray(hist) ? hist : []).slice(-HISTORY_KEEP)
          .map((h) => ({ text: clip(h && h.text, MAX_LEN), time: clip(h && h.time, 32) }))),
      };
    })
    .filter((r) => !isProtected(r.tags));
  if (mode === "replace" && !rows.length) return { error: "nothing valid to import, so nothing was deleted" };
  const stmts = [];
  if (mode === "replace") stmts.push(env.DB.prepare(`DELETE FROM memories WHERE ${NOT_RULES_SQL}`));
  for (const r of rows) {
    stmts.push(env.DB.prepare(
      "INSERT OR IGNORE INTO memories (id, text, tags, source, created, updated, history) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(r.id, r.text, r.tags, r.source, r.created, r.updated, r.history));
  }
  await runAll(env, stmts);
  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM memories").first();
  return { imported: rows.length, total: total.n };
}
