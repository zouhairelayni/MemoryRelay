// Accounts and sessions. Everything lives in D1; nothing about login is kept in the browser.
//  - Passwords: PBKDF2-SHA256 (100k iterations, the Workers maximum), 12+ characters, random salt.
//  - Sessions: 256-bit random token in an HttpOnly cookie named __Host-sid (Secure, Path=/, no Domain).
//    Only a SHA-256 hash of the token is stored in D1, so a leaked table cannot be replayed.
//  - Login throttling: 5 wrong passwords lock that email (and that IP) for 15 minutes.
//  - Setup works once: the owner row is inserted only if no user exists yet, in one statement.
import { PBKDF2_ITER, SESSION_DAYS } from "./constants.js";
import { fromHex, json, now, randomHex, toHex } from "./util.js";

const COOKIE = "__Host-sid";
const MIN_PASSWORD = 12;
const MAX_PASSWORD = 256;   // stops oversized input from costing CPU
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

export async function hashPassword(pw, saltHex) {
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PBKDF2_ITER, hash: "SHA-256" }, key, 256);
  return { hash: toHex(bits), salt: toHex(salt) };
}

// Compares two hex strings without stopping at the first difference.
export function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

export async function userCount(env) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first();
  return r.n;
}

export function cookieFrom(request, name) {
  const c = request.headers.get("cookie") || "";
  const m = c.match(new RegExp("(?:^|; )" + name + "=([^;]+)"));
  return m ? m[1] : null;
}

export async function currentUser(env, request) {
  const token = cookieFrom(request, COOKIE);
  if (!token) return null;
  return env.DB.prepare(
    "SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > ?"
  ).bind(await sha256Hex(token), Date.now()).first();
}

const sessionCookie = (token, maxAge) =>
  COOKIE + "=" + token + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" + maxAge;

async function startSession(env, userId) {
  const token = randomHex(32);
  await env.DB.prepare("DELETE FROM sessions WHERE expires <= ?").bind(Date.now()).run();
  await env.DB.prepare("INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)")
    .bind(await sha256Hex(token), userId, Date.now() + SESSION_DAYS * 86400000).run();
  return sessionCookie(token, SESSION_DAYS * 86400);
}

async function readCreds(request, minLength = MIN_PASSWORD) {
  const b = await request.json().catch(() => ({}));
  const email = String(b.email || "").trim().toLowerCase().slice(0, 254);
  const password = String(b.password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "enter a valid email" };
  if (password.length < minLength) return { error: "password must be at least " + minLength + " characters" };
  if (password.length > MAX_PASSWORD) return { error: "password is too long" };
  return { email, password };
}

// Failed-login counters live in D1 so they hold across Worker instances.
async function locked(env, keys) {
  for (const k of keys) {
    const r = await env.DB.prepare("SELECT fails, locked_until FROM login_fails WHERE key = ?").bind(k).first();
    if (r && r.locked_until > Date.now()) return true;
  }
  return false;
}
async function recordFail(env, keys) {
  for (const k of keys) {
    await env.DB.prepare(
      `INSERT INTO login_fails (key, fails, locked_until) VALUES (?, 1, 0)
       ON CONFLICT(key) DO UPDATE SET fails = fails + 1,
       locked_until = CASE WHEN fails + 1 >= ? THEN ? ELSE locked_until END`
    ).bind(k, MAX_FAILS, Date.now() + LOCK_MS).run();
  }
}
async function clearFails(env, keys) {
  for (const k of keys) await env.DB.prepare("DELETE FROM login_fails WHERE key = ?").bind(k).run();
}
const throttleKeys = (email, request) => [
  "email:" + email,
  "ip:" + (request.headers.get("cf-connecting-ip") || "unknown"),
];
const TOO_MANY = { error: "too many wrong passwords. Wait 15 minutes and try again." };

export async function authSetup(env, request) {
  const c = await readCreds(request, MIN_PASSWORD);
  if (c.error) return json({ error: c.error }, 400);
  const { hash, salt } = await hashPassword(c.password);
  // One statement: the row is written only if there is still no user, so two simultaneous setups cannot both win.
  const r = await env.DB.prepare(
    "INSERT INTO users (email, pass_hash, salt, created) SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)"
  ).bind(c.email, hash, salt, now()).run();
  if (!r.meta.changes) return json({ error: "account already exists, log in instead" }, 403);
  return json({ ok: true }, 200, await startSession(env, r.meta.last_row_id));
}

export async function authLogin(env, request) {
  // Login accepts any length, so accounts created before the 12-character rule can still sign in.
  const c = await readCreds(request, 1);
  if (c.error) return json({ error: c.error }, 400);
  const keys = throttleKeys(c.email, request);
  if (await locked(env, keys)) return json(TOO_MANY, 429);
  const u = await env.DB.prepare("SELECT id, pass_hash, salt FROM users WHERE email = ?").bind(c.email).first();
  const { hash } = await hashPassword(c.password, u ? u.salt : randomHex(16)); // same work whether or not the email exists
  if (!u || !sameText(hash, u.pass_hash)) {
    await recordFail(env, keys);
    return json({ error: "wrong email or password" }, 401);
  }
  await clearFails(env, keys);
  return json({ ok: true }, 200, await startSession(env, u.id));
}

export async function auth(request, env, url) {
  const p = url.pathname, m = request.method;
  if (p === "/auth/status" && m === "GET") {
    const user = await currentUser(env, request);
    return json({ setup: (await userCount(env)) === 0, loggedIn: !!user, email: user ? user.email : "" });
  }
  if (p === "/auth/setup" && m === "POST") return authSetup(env, request);
  if (p === "/auth/login" && m === "POST") return authLogin(env, request);
  if (p === "/auth/logout" && m === "POST") {
    const token = cookieFrom(request, COOKIE);
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(await sha256Hex(token)).run();
    return json({ ok: true }, 200, sessionCookie("", 0));
  }
  return json({ error: "no such route" }, 404);
}
