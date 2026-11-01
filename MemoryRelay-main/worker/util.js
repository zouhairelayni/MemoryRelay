// Small helpers with no database or network access.
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Every dynamic response: never cached, never sniffed.
const SAFE = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
export const json = (obj, status = 200, cookie = null, extra = {}) => {
  const h = { "content-type": "application/json; charset=utf-8", ...SAFE, ...extra };
  if (cookie) h["set-cookie"] = cookie;
  return new Response(JSON.stringify(obj), { status, headers: h });
};
export const now = () => new Date().toISOString().slice(0, 16).replace("T", " ");
export const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export const fromHex = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));
export const randomHex = (n) => toHex(crypto.getRandomValues(new Uint8Array(n)));
export const newId = () => randomHex(6); // 48 bits: no realistic collisions (old 8-char ids keep working)
export const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export const clip = (s, n) => String(s ?? "").slice(0, n);

export function similar(a, b) {
  const na = norm(a), nb = norm(b);
  if (na === nb) return true;
  const A = new Set(na.split(" ").filter(Boolean)), B = new Set(nb.split(" ").filter(Boolean));
  if (!A.size || !B.size) return false;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return common / (A.size + B.size - common) >= 0.8;
}

export const brief = (m) => ({ id: m.id, text: String(m.text).slice(0, 500), tags: m.tags || "", time: m.created });

// "rules" is a whole tag, never a substring: "rules", "a, rules", "RULES" count; "bylaws" or "rules-of-thumb" do not.
export const isProtected = (tags) => String(tags || "").split(",").map((t) => t.trim().toLowerCase()).includes("rules");
export const RULES_SQL = "(',' || REPLACE(LOWER(tags), ' ', '') || ',') LIKE '%,rules,%'";
export const NOT_RULES_SQL = "(',' || REPLACE(LOWER(tags), ' ', '') || ',') NOT LIKE '%,rules,%'";

// LIKE search that treats % and _ typed by the user as plain characters, with a cap on words
// (D1 allows only 100 bound values per statement).
export const likeEscape = (w) => w.replace(/[\\%_]/g, "\\$&");
export function searchWhere(q, max = 8) {
  const words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, max).map((w) => w.slice(0, 64));
  return {
    where: words.length ? "WHERE " + words.map(() => "(text || ' ' || tags) LIKE ? ESCAPE '\\'").join(" AND ") : "",
    params: words.map((w) => `%${likeEscape(w)}%`),
  };
}

export const safeJson = (s, fallback) => { try { const v = JSON.parse(s); return v ?? fallback; } catch { return fallback; } };

// Reads a JSON object out of a model answer: plain JSON, fenced JSON, or JSON surrounded by chatter.
export function extractJson(text) {
  const s = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(s); } catch { /* fall through */ }
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch { /* fall through */ } }
  return null;
}

// Bounded JSON body reader. Returns { value } or { error, status }.
export async function readJson(request, max = 262144) {
  if (Number(request.headers.get("content-length") || 0) > max) return { error: "request too large", status: 413 };
  let text = "";
  if (request.body && request.body.getReader) { // stop reading as soon as the limit is passed, even without a Content-Length
    const rd = request.body.getReader(), dec = new TextDecoder();
    let size = 0;
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { await rd.cancel().catch(() => {}); return { error: "request too large", status: 413 }; }
      text += dec.decode(value, { stream: true });
    }
    text += dec.decode();
  } else {
    text = await request.text();
    if (text.length > max) return { error: "request too large", status: 413 };
  }
  try { return { value: JSON.parse(text) }; } catch { return { error: "invalid JSON", status: 400, parse: true }; }
}

// A JSON body that must be an object. Anything else (null, a list, a number, bad JSON) counts as an empty object.
export async function readObject(request) {
  const b = await request.json().catch(() => null);
  return b && typeof b === "object" && !Array.isArray(b) ? b : {};
}

export async function runAll(env, stmts) {
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
}
