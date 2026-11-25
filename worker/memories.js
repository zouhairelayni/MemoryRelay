// Memory storage. The agent-facing functions are protected by the rules tag; the owner functions are not.
import { MAX_MEMORIES, MAX_TAGS } from "./constants.js";
import { getMemoryLimit } from "./memorySettings.js";
import { formatAgentMemory } from "./memoryFormat.js";
import { memoryTextError } from "../shared/memoryBudget.js";
import { NOT_RULES_SQL, clip, isProtected, newId, now, runAll, safeJson, similar } from "./util.js";
import { cleanDescription, decodeMetadata, descriptionFromText, fullEntry, normalizeMetadata, queryMemoryIndex } from "./memoryIndex.js";
import { counterOr } from "./counters.js";

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

async function insertMemory(env, text, tags, source, description = "", metadata = {}) {
  for (let i = 0; i < 3; i++) {
    const id = newId(), t = now();
    try {
      await env.DB.prepare("INSERT INTO memories (id, text, tags, source, created, updated, history, description, metadata) VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?)")
        .bind(id, text, tags, clip(source, 60), t, t, description, JSON.stringify(metadata)).run();
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
  const text = formatAgentMemory(a.text);
  if (!text) return "nothing saved: empty text";
  const invalid = memoryTextError(text, await getMemoryLimit(env));
  if (invalid) return `not saved: ${invalid}; split it into smaller facts`;
  const t = agentTags(a.tags);
  if (t.error) return "not saved: " + t.error;
  let description, metadata;
  try { description = a.description === undefined ? "" : cleanDescription(a.description); metadata = normalizeMetadata(a.metadata); }
  catch (e) { return "not saved: " + e.message; }
  const total = await counterOr(env, "memories_total", "SELECT COUNT(*) AS n FROM memories");
  if (total >= MAX_MEMORIES) return `not saved: the memory is full (${MAX_MEMORIES}). Ask the owner to clean it up`;
  const dup = await findDuplicate(env, text);
  if (dup) return `duplicate of ${dup.id}, not saved`;
  return `saved ${await insertMemory(env, text, t.tags, source, description, metadata)}`;
}

// The index contains descriptions, IDs, and typed labels, NEVER full Markdown bodies.
// Cursor by offset until next_offset is null; no first-20 or first-500 truncation.
export async function search(env, a) {
  // Compatibility for existing ChatGPT MCP installations whose cached tool schema
  // only accepts {query, limit} and does not yet expose get_memory or offset.
  // New clients use list_memories/get_memory/offset directly. This never writes.
  const q = String(a?.query || "").trim();
  const page = /^@page:(\d{1,5})(?:\s+([\s\S]*))?$/.exec(q);
  if (page) return queryMemoryIndex(env, { ...a, query: page[2] || "", offset: Math.min(5000, Number(page[1])) });
  const read = /^@read:([a-f0-9]{12})$/i.exec(q);
  if (read) return getMemory(env, { memory_id: read[1].toLowerCase() });
  return queryMemoryIndex(env, a);
}

export async function listMemoryIndex(env, a = {}) {
  return queryMemoryIndex(env, a);
}

export async function getMemory(env, a) {
  const id = String(a.memory_id || "");
  const row = await env.DB.prepare("SELECT * FROM memories WHERE id = ?").bind(id).first();
  return row ? fullEntry(row) : { error: "memory not found" };
}

export async function recent(env, a) {
  const n = Math.min(Math.max(Number(a.n) || 5, 1), 20);
  const total = await counterOr(env, "memories_total", "SELECT COUNT(*) AS n FROM memories");
  const { results } = await env.DB.prepare(
    "SELECT * FROM memories ORDER BY created DESC, rowid DESC LIMIT ?"
  ).bind(n).all();
  return { total, results: results.map(fullEntry) };
}

export async function updateMemory(env, a) {
  const row = await env.DB.prepare("SELECT * FROM memories WHERE id = ?").bind(String(a.memory_id)).first();
  if (!row) return "not found";
  if (isProtected(row.tags)) return "protected: rules memories cannot be changed through the connector";
  const hasText = Object.hasOwn(a, "text"), hasTags = Object.hasOwn(a, "tags");
  if (!hasText && !hasTags && !Object.hasOwn(a, "description") && !Object.hasOwn(a, "metadata"))
    return "nothing to update: pass text, context tags, description or metadata";
  const newText = hasText ? String(a.text || "").trim() : "";
  if (hasText && !newText) return "not updated: text cannot be empty";
  let text = row.text, tags = row.tags, description = row.description || "", metadata = decodeMetadata(row);
  try {
    if (Object.hasOwn(a, "description")) description = cleanDescription(a.description);
    if (Object.hasOwn(a, "metadata")) metadata = normalizeMetadata({ ...metadata, ...a.metadata });
  } catch (e) { return "not updated: " + e.message; }
  const history = safeJson(row.history, []).slice(-(HISTORY_KEEP - 1));
  if (newText) {
    const formatted = formatAgentMemory(newText);
    const invalid = memoryTextError(formatted, await getMemoryLimit(env));
    if (invalid) return `not updated: ${invalid}`;
    if (formatted !== row.text) { history.push({ text: row.text, time: row.updated }); text = formatted; }
  }
  if (hasTags) {
    const t = agentTags(a.tags);
    if (t.error) return "not updated: " + t.error;
    tags = t.tags;
  }
  await env.DB.prepare("UPDATE memories SET text = ?, tags = ?, updated = ?, history = ?, description = ?, metadata = ? WHERE id = ?")
    .bind(text, tags, now(), JSON.stringify(history), description, JSON.stringify(metadata), row.id).run();
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
  const invalid = memoryTextError(text, await getMemoryLimit(env));
  if (invalid) return { error: invalid };
  const rule = b.rule === true;
  const t = ownerTags(rule, b.tags);
  if (t.error) return t;
  let description, metadata;
  try { description = b.description === undefined ? "" : cleanDescription(b.description); metadata = normalizeMetadata(b.metadata); }
  catch (e) { return { error: e.message }; }
  const total = await counterOr(env, "memories_total", "SELECT COUNT(*) AS n FROM memories");
  if (total >= MAX_MEMORIES) return { error: `the memory is full (${MAX_MEMORIES}). Delete some first` };
  const dup = await findDuplicate(env, text);
  if (dup) return { error: `a similar memory already exists (${dup.id})` };
  const id = await insertMemory(env, text, t.tags, rule ? "owner" : "dashboard", description, metadata);
  return { ok: true, id, rule };
}

export async function editMemory(env, id, b) {
  const row = await env.DB.prepare("SELECT * FROM memories WHERE id = ?").bind(String(id)).first();
  if (!row) return { error: "memory not found" };
  const text = String(b.text || "").trim();
  if (!text) return { error: "text cannot be empty" };
  const invalid = memoryTextError(text, await getMemoryLimit(env));
  if (invalid) return { error: invalid };
  const rule = typeof b.rule === "boolean" ? b.rule : isProtected(row.tags);
  let tags = row.tags;
  if (rule || typeof b.tags === "string") {
    const t = ownerTags(rule, b.tags);
    if (t.error) return t;
    tags = t.tags;
  }
  if (!rule && isProtected(tags)) tags = "";
  let description = row.description || "", metadata = decodeMetadata(row);
  try {
    if (Object.hasOwn(b, "description")) description = cleanDescription(b.description);
    if (Object.hasOwn(b, "metadata")) metadata = normalizeMetadata({ ...metadata, ...b.metadata });
  } catch (e) { return { error: e.message }; }
  const history = safeJson(row.history, []).slice(-(HISTORY_KEEP - 1));
  if (text !== row.text) history.push({ text: row.text, time: row.updated });
  await env.DB.prepare("UPDATE memories SET text = ?, tags = ?, updated = ?, history = ?, description = ?, metadata = ? WHERE id = ?")
    .bind(text, tags, now(), JSON.stringify(history), description, JSON.stringify(metadata), row.id).run();
  return { ok: true, id: row.id, rule };
}

// ---- owner (dashboard) helpers: list, export, import ----

export async function listMemories(env, options = {}) {
  // Backward compatible with the old search-string signature.
  const f = typeof options === "string" ? { query: options } : options;
  const page = await queryMemoryIndex(env, f, { full: true, defaultLimit: 30 });
  return { count: page.count, total: page.total, offset: page.offset, next_offset: page.next_offset, items: page.results };
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
  const maxTokens = await getMemoryLimit(env);
  // Imports never silently truncate facts; all entries are checked before any deletion.
  const oversize = incoming.find((x) => x && typeof x.text === "string" && memoryTextError(x.text.trim(), maxTokens));
  if (oversize) return { error: `import contains an oversized memory: ${memoryTextError(oversize.text.trim(), maxTokens)}` };
  // Reject malformed new metadata before any destructive replace operation.
  try { for (const x of incoming) if (x && typeof x === "object" && typeof x.text === "string" && x.text.trim()) {
    if (x.description !== undefined) cleanDescription(x.description);
    normalizeMetadata(typeof x.metadata === "string" ? JSON.parse(x.metadata) : x.metadata);
  } } catch (e) { return { error: "invalid memory index metadata: " + e.message }; }
  const rows = incoming
    .filter((x) => x && typeof x === "object" && typeof x.text === "string" && x.text.trim())
    .map((x) => {
      const hist = typeof x.history === "string" ? safeJson(x.history, []) : x.history;
      return {
        id: /^[A-Za-z0-9_-]{1,40}$/.test(String(x.id || "")) ? String(x.id) : newId(),
        text: x.text.trim(),
        tags: cleanTags(x.tags),
        description: x.description === undefined ? "" : cleanDescription(x.description),
        metadata: JSON.stringify(normalizeMetadata(typeof x.metadata === "string" ? safeJson(x.metadata, {}) : x.metadata)),
        source: clip(x.source || "import", 60),
        created: clip(x.created || x.time || now(), 32),
        updated: clip(x.updated || x.time || now(), 32),
        history: JSON.stringify((Array.isArray(hist) ? hist : []).slice(-HISTORY_KEEP)
          .map((h) => ({ text: clip(h && h.text, 32000), time: clip(h && h.time, 32) }))),
      };
    })
    .filter((r) => !isProtected(r.tags));
  if (mode === "replace" && !rows.length) return { error: "nothing valid to import, so nothing was deleted" };
  const stmts = [];
  if (mode === "replace") stmts.push(env.DB.prepare(`DELETE FROM memories WHERE ${NOT_RULES_SQL}`));
  for (const r of rows) {
    stmts.push(env.DB.prepare(
      "INSERT OR IGNORE INTO memories (id, text, tags, source, created, updated, history, description, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(r.id, r.text, r.tags, r.source, r.created, r.updated, r.history, r.description, r.metadata));
  }
  await runAll(env, stmts);
  const total = await counterOr(env, "memories_total", "SELECT COUNT(*) AS n FROM memories");
  return { imported: rows.length, total };
}
