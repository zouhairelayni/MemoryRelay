// Accounts and sessions: PBKDF2 password hashing, sid cookie.
import { PBKDF2_ITER, SESSION_DAYS } from "./constants.js";
import { fromHex, json, now, randomHex, toHex } from "./util.js";

export async function hashPassword(pw, saltHex) {
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PBKDF2_ITER, hash: "SHA-256" }, key, 256);
  return { hash: toHex(bits), salt: toHex(salt) };
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
  const token = cookieFrom(request, "sid");
  if (!token) return null;
  return env.DB.prepare(
    "SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > ?"
  ).bind(token, Date.now()).first();
}

export const sessionCookie = (token, maxAge) =>
  "sid=" + token + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" + maxAge;

export async function startSession(env, userId) {
  const token = randomHex(32);
  await env.DB.prepare("INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)")
    .bind(token, userId, Date.now() + SESSION_DAYS * 86400000).run();
  return token;
}

export async function readCreds(request) {
  const b = await request.json().catch(() => ({}));
  const email = String(b.email || "").trim().toLowerCase();
  const password = String(b.password || "");
  if (!email.includes("@")) return { error: "enter a valid email" };
  if (password.length < 8) return { error: "password must be at least 8 characters" };
  return { email, password };
}

export async function authSetup(env, request) {
  if ((await userCount(env)) > 0) return json({ error: "account already exists, log in instead" }, 403);
  const c = await readCreds(request);
  if (c.error) return json({ error: c.error }, 400);
  const { hash, salt } = await hashPassword(c.password);
  const r = await env.DB.prepare("INSERT INTO users (email, pass_hash, salt, created) VALUES (?, ?, ?, ?)")
    .bind(c.email, hash, salt, now()).run();
  const token = await startSession(env, r.meta.last_row_id);
  return json({ ok: true }, 200, sessionCookie(token, SESSION_DAYS * 86400));
}

export async function authLogin(env, request) {
  const c = await readCreds(request);
  if (c.error) return json({ error: c.error }, 400);
  const u = await env.DB.prepare("SELECT id, pass_hash, salt FROM users WHERE email = ?").bind(c.email).first();
  if (!u) return json({ error: "wrong email or password" }, 401);
  const { hash } = await hashPassword(c.password, u.salt);
  if (hash !== u.pass_hash) return json({ error: "wrong email or password" }, 401);
  const token = await startSession(env, u.id);
  return json({ ok: true }, 200, sessionCookie(token, SESSION_DAYS * 86400));
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
    const token = cookieFrom(request, "sid");
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
    return json({ ok: true }, 200, sessionCookie("", 0));
  }
  return json({ error: "no such route" }, 404);
}
