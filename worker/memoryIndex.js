// Search-index fields are independent of legacy context tags and Markdown bodies.
// Empty metadata means "unknown", never inferred from a project's name or content.
import { safeJson } from "./util.js";
import { counterOr } from "./counters.js";

export const METADATA_FIELDS = ["app", "platforms", "feature", "version", "languages", "stack"];
const SINGLE = ["app", "feature", "version"];
const MULTI = ["platforms", "languages", "stack"];
const EMPTY = { app: "", platforms: [], feature: "", version: "", languages: [], stack: [] };
export const emptyMetadata = () => ({ ...EMPTY, platforms: [], languages: [], stack: [] });

export function cleanDescription(v) {
  if (typeof v !== "string") throw new Error("description must be text");
  if (v.length > 280) throw new Error("description must be 280 characters or fewer");
  return v.trim();
}

export function descriptionFromText(value) {
  // A verbatim extract, not an AI-generated claim. An explicit description always takes precedence.
  const lines = String(value || "").split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !/^```/.test(s));
  const first = lines.find((s) => !/^[-*+]\s*$/.test(s)) || "";
  return first.replace(/^#{1,4}\s+/, "").replace(/^[-*+]\s+/, "").replace(/^\*\*(.+)\*\*$/, "$1").replace(/\*([^*]+)\*/g, "$1").slice(0, 220);
}

export function normalizeMetadata(raw) {
  if (raw === undefined || raw === null) return emptyMetadata();
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("metadata must be an object");
  const extra = Object.keys(raw).filter((k) => !METADATA_FIELDS.includes(k));
  if (extra.length) throw new Error("unknown metadata field: " + extra[0]);
  const meta = emptyMetadata();
  for (const key of SINGLE) {
    const v = raw[key] ?? "";
    if (typeof v !== "string" || v.length > 100) throw new Error(key + " must be text (max 100 characters)");
    meta[key] = v.trim();
  }
  for (const key of MULTI) {
    const values = raw[key] ?? [];
    if (!Array.isArray(values) || values.length > 16 || values.some((v) => typeof v !== "string" || v.length > 48))
      throw new Error(key + " must be a list of up to 16 short names");
    meta[key] = [...new Map(values.map((v) => v.trim()).filter(Boolean).map((v) => [v.toLowerCase(), v])).values()];
  }
  return meta;
}

export function decodeMetadata(row) {
  return normalizeMetadata(safeJson(row.metadata || "{}", {}));
}

export function indexEntry(row) {
  return {
    id: row.id,
    description: row.description || descriptionFromText(row.text),
    metadata: decodeMetadata(row),
    tags: row.tags || "", // legacy context tags (including protected 'rules') are separate
    source: row.source || "",
    created: row.created || row.time || "",
    updated: row.updated || row.created || row.time || "",
  };
}

export function fullEntry(row) {
  return { ...indexEntry(row), text: row.text, time: row.created || row.time || "" };
}

export function paging(a, fallback = 20) {
  const limit = a.limit === undefined ? fallback : Number(a.limit);
  const offset = a.offset === undefined ? 0 : Number(a.offset);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("limit must be between 1 and 100");
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 5000) throw new Error("offset must be between 0 and 5000");
  return { limit, offset };
}

export function buildMemoryWhere(a = {}) {
  const clauses = [], params = [];
  if (a.rule === "rules") clauses.push("(',' || REPLACE(LOWER(tags), ' ', '') || ',') LIKE '%,rules,%'");
  if (a.rule === "memories") clauses.push("(',' || REPLACE(LOWER(tags), ' ', '') || ',') NOT LIKE '%,rules,%'");
  const like = (v) => String(v).replace(/[\\%_]/g, "\\$&");
  const words = String(a.query || "").trim().split(/\s+/).filter(Boolean).slice(0, 8);
  for (const w of words) {
    if (w.length > 64) throw new Error("each query word must be 64 characters or fewer");
    clauses.push("LOWER(text || ' ' || tags || ' ' || description || ' ' || metadata) LIKE ? ESCAPE '\\'");
    params.push("%" + like(w.toLowerCase()) + "%");
  }
  for (const key of SINGLE) if (a[key] !== undefined && a[key] !== "") {
    if (typeof a[key] !== "string" || a[key].length > 100) throw new Error(key + " must be short text");
    clauses.push(`LOWER(json_extract(metadata, '$.${key}')) = LOWER(?)`);
    params.push(a[key]);
  }
  for (const key of MULTI) if (a[key] !== undefined && a[key] !== "") {
    if (typeof a[key] !== "string" || a[key].length > 48) throw new Error(key + " must be short text");
    clauses.push(`EXISTS (SELECT 1 FROM json_each(memories.metadata, '$.${key}') WHERE LOWER(value) = LOWER(?))`);
    params.push(a[key]);
  }
  return { where: clauses.length ? "WHERE " + clauses.join(" AND ") : "", params };
}

export async function queryMemoryIndex(env, filters = {}, opts = {}) {
  const { limit, offset } = paging(filters, opts.defaultLimit ?? 20);
  const { where, params } = buildMemoryWhere(filters);
  // An unfiltered list needs only the maintained total. Any filter or query still
  // needs a real COUNT because it has to know which rows match.
  const total = where
    ? Number((await env.DB.prepare(`SELECT COUNT(*) n FROM memories ${where}`).bind(...params).first())?.n) || 0
    : await counterOr(env, "memories_total", "SELECT COUNT(*) n FROM memories");
  // Index paging avoids transferring full memory bodies from D1. The first 256
  // characters are fetched only to derive a faithful legacy description.
  const projection = opts.full ? "*" : "id, substr(text, 1, 256) AS text, tags, source, created, updated, description, metadata";
  const { results } = await env.DB.prepare(`SELECT ${projection} FROM memories ${where} ORDER BY created DESC, rowid DESC LIMIT ? OFFSET ?`)
    .bind(...params, limit, offset).all();
  return { total, count: results.length, limit, offset, next_offset: offset + results.length < total ? offset + results.length : null,
    results: results.map(opts.full ? fullEntry : indexEntry) };
}
