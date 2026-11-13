// Optional encryption of provider API keys at rest.
// Set a KEY_SECRET (npx wrangler secret put KEY_SECRET, a long random string) and keys are stored as AES-GCM ciphertext,
// so a copy of the database alone does not reveal them. Without a KEY_SECRET nothing changes.
// Keep the secret: if it is lost the saved keys cannot be read and must be added again.
const te = new TextEncoder(), td = new TextDecoder();
const PREFIX = "enc:v1:";
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
let cached = { secret: "", key: null };

async function aesKey(env) {
  const secret = String(env.KEY_SECRET);
  if (cached.secret !== secret) {
    const base = await crypto.subtle.importKey("raw", te.encode(secret), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: te.encode("memoryrelay-key-v1"), iterations: 100000, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    cached = { secret, key };
  }
  return cached.key;
}

export const isSealed = (v) => String(v).startsWith(PREFIX);
// The last 4 characters stay readable (the dashboard already shows them) so listing keys never needs the secret.
export const keyTail = (stored) => isSealed(stored) ? decodeURIComponent(String(stored).split(":")[2] || "") : String(stored).slice(-4);

export async function sealKey(env, plain) {
  if (!env.KEY_SECRET || isSealed(plain)) return plain;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(env), te.encode(plain)));
  return PREFIX + encodeURIComponent(plain.slice(-4)) + ":" + b64(iv) + ":" + b64(ct);
}

// The usable key, or null when it is encrypted and the secret is missing or wrong.
export async function openKey(env, stored) {
  if (!isSealed(stored)) return stored;
  if (!env.KEY_SECRET) return null;
  try {
    const [, , , iv, ct] = String(stored).split(":");
    return td.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(env), unb64(ct)));
  } catch { return null; }
}

// Rows from a *_keys table with the key opened. Rows that cannot be opened are dropped; `locked` counts them.
export async function openRows(env, rows) {
  const out = []; let locked = 0;
  for (const r of rows) { const key = await openKey(env, r.key); if (key) out.push({ ...r, key }); else locked++; }
  return { rows: out, locked };
}
export const LOCKED_MESSAGE = "saved keys are encrypted but KEY_SECRET is missing or wrong on this Worker";

// Same key already saved? (Ciphertext differs every time, so the table's UNIQUE column cannot tell.)
export async function hasKey(env, table, plain) {
  const rows = (await env.DB.prepare(`SELECT key FROM ${table}`).all()).results; // table names are fixed in code, never user input
  for (const r of rows) if ((await openKey(env, r.key)) === plain) return true;
  return false;
}

// Encrypts keys that were saved before KEY_SECRET was set.
export async function sealAllKeys(env) {
  if (!env.KEY_SECRET) return 0;
  let n = 0;
  for (const table of ["gemini_keys", "openrouter_keys", "nvidia_keys", "openai_keys"]) {
    const rows = (await env.DB.prepare(`SELECT id, key FROM ${table} WHERE key NOT LIKE 'enc:v1:%'`).all()).results;
    for (const r of rows) { await env.DB.prepare(`UPDATE ${table} SET key = ? WHERE id = ?`).bind(await sealKey(env, r.key), r.id).run(); n++; }
  }
  return n;
}
