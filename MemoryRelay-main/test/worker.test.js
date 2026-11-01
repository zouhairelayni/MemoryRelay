import test from "node:test";
import assert from "node:assert/strict";
import { createD1 } from "./helpers/d1.js";
import worker from "../worker/index.js";
import { resetSchemaCache } from "../worker/db.js";

const B = "http://localhost";
const setup = async () => {
  resetSchemaCache();
  const { db, DB } = createD1();
  const env = { DB, ASSETS: { fetch: async () => new Response("<div id=root></div>", { headers: { "content-type": "text/html" } }) } };
  const ctx = { waitUntil: (p) => p };
  const call = (path, init) => worker.fetch(new Request(B + path, init), env, ctx);
  const res = await call("/auth/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "o@x.io", password: "longenough12" }) });
  const cookie = res.headers.get("set-cookie").split(";")[0];
  const api = (path, method = "GET", body) => call(path, { method, headers: { cookie, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const services = (await (await api("/api/services")).json()).services;
  const mcp = async (name, args) => {
    const r = await call(services[0].url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
    return (await r.json()).result.content[0].text;
  };
  return { db, call, api, mcp };
};

test("first run creates the tables and one default connection", async () => {
  const { db, api } = await setup();
  for (const t of ["users", "sessions", "memories", "config", "services", "gemini_keys", "gemini_models", "service_stats", "skills", "openrouter_keys", "openrouter_models", "openrouter_cooldowns"]) {
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(t), t);
  }
  assert.equal((await (await api("/api/services")).json()).services.length, 1);
});

test("only one owner account can be created", async () => {
  const { call } = await setup();
  const r = await call("/auth/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "b@x.io", password: "longenough12" }) });
  assert.equal(r.status, 403);
});

test("API needs a session, MCP needs a valid secret", async () => {
  const { call } = await setup();
  assert.equal((await call("/api/memories")).status, 401);
  assert.equal((await call("/mcp/nope", { method: "POST", body: "{}" })).status, 404);
});

test("agents can save, search and update, but never touch rules", async () => {
  const { api, mcp } = await setup();
  assert.match(await mcp("remember", { text: "Likes tea" }), /^saved /);
  assert.match(await mcp("remember", { text: "Likes tea" }), /duplicate/);
  assert.match(await mcp("remember", { text: "x", tags: "rules" }), /reserved/);
  const rule = await (await api("/api/memories", "POST", { text: "Never delete without asking", rule: true })).json();
  assert.equal(rule.rule, true);
  assert.match(await mcp("forget", { memory_id: rule.id }), /protected/);
  assert.match(await mcp("update_memory", { memory_id: rule.id, text: "hacked" }), /protected/);
  assert.equal((await (await api("/api/memories/" + rule.id, "DELETE")).json()).deleted, 1); // the owner can
});

test("owner cannot type the rules tag by hand and is limited to 3 tags", async () => {
  const { api } = await setup();
  assert.equal((await api("/api/memories", "POST", { text: "a", tags: "rules" })).status, 400);
  assert.equal((await api("/api/memories", "POST", { text: "b", tags: "a,b,c,d,e,f" })).status, 400);
});

test("per-connection counters", async () => {
  const { api, mcp, db } = await setup();
  await mcp("remember", { text: "One fact" });
  await mcp("search", { query: "fact" });
  await new Promise((r) => setTimeout(r, 20));
  const s = (await (await api("/api/stats")).json()).services[0];
  assert.equal(s.n_write, 1);
  assert.equal(s.n_read, 1);
  assert.ok(db);
});

test("only revoked connections can be deleted", async () => {
  const { api } = await setup();
  const id = (await (await api("/api/services")).json()).services[0].id;
  assert.equal((await api("/api/services/" + id, "DELETE")).status, 400);
  await api("/api/services/" + id + "/revoke", "POST");
  assert.equal((await api("/api/services/" + id, "DELETE")).status, 200);
});

test("Gemini pools: add, duplicate key ignored, models reorder", async () => {
  const { api } = await setup();
  await api("/api/gemini", "POST", { op: "add_key", label: "a", key: "k1" });
  await api("/api/gemini", "POST", { op: "add_key", label: "b", key: "k1" });
  let s = await (await api("/api/gemini")).json();
  assert.equal(s.keys.length, 1);
  assert.equal(s.keys[0].tail, "k1");
  const first = s.models[0].name;
  s = await (await api("/api/gemini", "POST", { op: "move_model", name: first, dir: 1 })).json();
  assert.equal(s.models[1].name, first);
});

test("import skips rules and replace keeps them", async () => {
  const { api } = await setup();
  await api("/api/memories", "POST", { text: "Keep me as a rule", rule: true });
  await api("/api/memories", "POST", { text: "Plain one" });
  await api("/api/import?mode=replace", "POST", [{ text: "From file" }, { text: "Sneaky", tags: "rules" }]);
  const items = (await (await api("/api/memories")).json()).items.map((m) => m.text).sort();
  assert.deepEqual(items, ["From file", "Keep me as a rule"]);
});

test("everything else is served by the static assets", async () => {
  const { call } = await setup();
  assert.match(await (await call("/anything")).text(), /root/);
});

test("wrong passwords lock the account for 15 minutes", async () => {
  const { call } = await setup();
  const login = (password) => call("/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "o@x.io", password }) });
  for (let i = 0; i < 5; i++) assert.equal((await login("wrong-password-1")).status, 401);
  assert.equal((await login("longenough12")).status, 429, "correct password is refused while locked");
});

test("a correct login clears the failure count", async () => {
  const { call } = await setup();
  const login = (password) => call("/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "o@x.io", password }) });
  for (let i = 0; i < 4; i++) await login("wrong-password-1");
  assert.equal((await login("longenough12")).status, 200);
  for (let i = 0; i < 4; i++) await login("wrong-password-1");
  assert.equal((await login("longenough12")).status, 200, "count restarted after success");
});

test("session tokens are stored hashed, and the cookie is __Host- prefixed", async () => {
  const { db, call } = await setup();
  const res = await call("/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "o@x.io", password: "longenough12" }) });
  const cookie = res.headers.get("set-cookie");
  assert.match(cookie, /^__Host-sid=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  const token = cookie.split(";")[0].split("=")[1];
  const rows = db.prepare("SELECT token FROM sessions").all();
  assert.ok(rows.length >= 1);
  assert.ok(rows.every((r) => r.token !== token), "raw token is not stored");
});

test("short passwords are refused at setup", async () => {
  resetSchemaCache();
  const { DB } = createD1();
  const env = { DB, ASSETS: { fetch: async () => new Response("") } };
  const r = await worker.fetch(new Request(B + "/auth/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "o@x.io", password: "short" }) }), env, { waitUntil: (p) => p });
  assert.equal(r.status, 400);
});

test("state-changing requests from another site are refused", async () => {
  const { call, api } = await setup();
  const r = await call("/api/services", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" });
  assert.equal(r.status, 403, "refused before the session is even checked");
  const ok = await api("/api/services", "POST", { name: "x" });
  assert.equal(ok.status, 200);
});
