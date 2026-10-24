// Small helpers with no database or network access.
import { MAX_LEN } from "./constants.js";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const json = (obj, status = 200, cookie = null) => {
  const h = { "content-type": "application/json; charset=utf-8" };
  if (cookie) h["set-cookie"] = cookie;
  return new Response(JSON.stringify(obj), { status, headers: h });
};
export const now = () => new Date().toISOString().slice(0, 16).replace("T", " ");
export const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 8);
export const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export const fromHex = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));
export const randomHex = (n) => toHex(crypto.getRandomValues(new Uint8Array(n)));
export const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function similar(a, b) {
  const na = norm(a), nb = norm(b);
  if (na === nb) return true;
  const A = new Set(na.split(" ").filter(Boolean)), B = new Set(nb.split(" ").filter(Boolean));
  if (!A.size || !B.size) return false;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return common / (A.size + B.size - common) >= 0.8;
}

export const brief = (m) => ({ id: m.id, text: m.text.slice(0, 500), tags: m.tags || "", time: m.created });
export const isProtected = (tags) => String(tags || "").split(",").map((t) => t.trim().toLowerCase()).includes("rules");

export async function runAll(env, stmts) {
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
}