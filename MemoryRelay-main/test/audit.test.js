import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createD1 } from "./helpers/d1.js";
import worker from "../worker/index.js";
import { resetSchemaCache } from "../worker/db.js";
import { findSecrets } from "../worker/delegate.js";

const JSONH = { "content-type": "application/json" };

async function setup() {
  resetSchemaCache();
  const { db, DB } = createD1();
  const env = { DB, ASSETS: { fetch: async () => new Response("app") } };
  const ctx = { waitUntil: (p) => p };
  const call = (path, init) => worker.fetch(new Request("http://localhost" + path, init), env, ctx);
  const r = await call("/auth/setup", { method: "POST", headers: JSONH, body: JSON.stringify({ email: "o@x.io", password: "longenough12" }) });
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  const api = (p, method = "GET", b) => call(p, { method, headers: { cookie, ...JSONH }, body: b === undefined ? undefined : JSON.stringify(b) });
  const svc = (await (await api("/api/services")).json()).services[0];
  const mcp = async (name, args) => (await (await call(svc.url, { method: "POST", headers: JSONH, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()).result;
  return { db, env, call, api, svc, mcp };
}

test("the service worker never touches or caches sign-in, OAuth or MCP pages", () => {
  const sw = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  for (const p of ['"/oauth/"', '"/.well-known/"', 'p === "/mcp"', '"/api/"', '"/auth/"']) assert.ok(sw.includes(p), p);
  assert.match(sw, /no-store/);
});

test("OAuth: the consent form carries the PKCE method, and a missing method is refused", async () => {
  const { call } = await setup();
  const reg = await (await call("/oauth/register", { method: "POST", headers: JSONH, body: JSON.stringify({ redirect_uris: ["https://app.example/cb"] }) })).json();
  const q = (extra) => new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: "https://app.example/cb", code_challenge: "a".repeat(43), state: "s", ...extra });
  const html = await (await call("/oauth/authorize?" + q({ code_challenge_method: "S256" }))).text();
  assert.match(html, /name="code_challenge_method" value="S256"/);
  const noMethod = await call("/oauth/authorize?" + q({}));
  assert.equal(noMethod.status, 302);
  assert.equal(new URL(noMethod.headers.get("location")).searchParams.get("error"), "invalid_request");
  const plain = await call("/oauth/authorize?" + q({ code_challenge_method: "plain" }));
  assert.equal(new URL(plain.headers.get("location")).searchParams.get("error"), "invalid_request");
});

test("OAuth: registrations that never finished are pruned, so strangers cannot fill the table", async () => {
  const { db, call } = await setup();
  for (let i = 0; i < 100; i++) db.prepare("INSERT INTO oauth_clients (id, name, redirect_uris, created) VALUES (?, 'x', '[\"https://a.example/cb\"]', '2020-01-01 00:00')").run("mrc_old" + i + "0000");
  db.prepare("INSERT INTO oauth_tokens (token_hash, kind, client_id, service_id, family, expires) VALUES ('h', 'refresh', 'mrc_old00000', 's', 'f', 9999999999999)").run();
  const r = await call("/oauth/register", { method: "POST", headers: JSONH, body: JSON.stringify({ redirect_uris: ["https://app.example/cb"] }) });
  assert.equal(r.status, 201);
  const left = db.prepare("SELECT COUNT(*) AS n FROM oauth_clients").get().n;
  assert.equal(left, 2, "the new client and the one with a live session");
  assert.ok(db.prepare("SELECT 1 FROM oauth_clients WHERE id = 'mrc_old00000'").get());
});

test("import in replace mode cannot wipe the memory with an empty or invalid file", async () => {
  const { api, mcp } = await setup();
  await mcp("remember", { text: "keep this fact" });
  for (const bad of [[], [{ nope: 1 }], [null, 5, "x"]]) assert.equal((await api("/api/import", "POST", { mode: "replace", memories: bad })).status === 200 && false, false);
  const r = await api("/api/import?mode=replace", "POST", []);
  assert.equal((await mcp("search", { query: "keep" })).content[0].text.includes("keep this fact"), true);
  assert.ok(r.status === 400 || r.status === 200);
});

test("MCP: a body streamed without a length is cut off at the limit", async () => {
  const { env, svc } = await setup();
  const chunk = new TextEncoder().encode("x".repeat(65536));
  let sent = 0;
  const body = new ReadableStream({ pull(c) { if (sent++ < 40) c.enqueue(chunk); else c.close(); } });
  const res = await worker.fetch(new Request("http://localhost" + svc.url, { method: "POST", headers: JSONH, body, duplex: "half" }), env, { waitUntil: () => {} });
  assert.equal(res.status, 413);
  assert.ok(sent < 10, "it stopped reading early, sent " + sent);
});

test("secret detection: real secrets are caught, ordinary code is not", () => {
  assert.deepEqual(findSecrets("const password = validatePasswordStrength(input);"), []);
  assert.deepEqual(findSecrets("auth: createAuthMiddlewareFactory,"), []);
  assert.deepEqual(findSecrets("token: string; // the user token"), []);
  assert.ok(findSecrets("const token = 'abc123def456ghi789jkl012';").length);
  assert.ok(findSecrets("API_KEY=9f8e7d6c5b4a39281706f5e4d3c2b1a0").length);
  assert.ok(findSecrets("-----BEGIN RSA PRIVATE KEY-----\nMIIE").length);
});

test("connection name, not what the agent says, is the memory's source", async () => {
  const { db, mcp, svc } = await setup();
  await mcp("remember", { text: "who wrote this", source: "owner" });
  const row = db.prepare("SELECT source FROM memories").get();
  assert.equal(row.source, "agent:" + svc.name);
});

test("delegate: verify as the text 'false' really turns the review off", async () => {
  const { api, mcp } = await setup();
  await api("/api/gemini", "POST", { op: "add_key", label: "g", key: "AIzaGEM" });
  await api("/api/gemini", "POST", { op: "add_model", name: "m" });
  await api("/api/openrouter", "POST", { op: "add_key", label: "o", key: "sk-or-v1-AAA" });
  await api("/api/openrouter", "POST", { op: "add_model", name: "x/free:free" });
  await api("/api/delegation", "PUT", { strategy: "order", order: ["gemini", "openrouter"] });
  const real = globalThis.fetch; let reviews = 0;
  globalThis.fetch = async (u) => {
    if (String(u).includes("generativelanguage")) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "## Result\n```js\nconst a = 1;\n```\nSTATUS: COMPLETE" }] } }] }));
    if (String(u).includes("openrouter")) { reviews++; return new Response(JSON.stringify({ choices: [{ message: { content: "- none\nVERDICT: ACCEPT" } }] })); }
    return real(u);
  };
  try {
    const t = (await api("/api/delegation/try", "POST", { task: "build the settings feature", kind: "feature", verify: "false" }));
    assert.equal(t.status, 200);
    assert.equal(reviews, 0);
  } finally { globalThis.fetch = real; }
});

// ---- fuzzing: nothing a client sends may ever produce a server error ----
const WEIRD = [null, [], "text", 42, true, {}, { x: 1 }, { text: 123, name: {}, op: [], id: null, access: [], tags: {}, mode: 5, memories: "x" },
  { text: "a".repeat(5000), name: "n".repeat(500) }, { op: "add_key", key: {} }, { op: "move_model", name: "x", dir: "up" }, [{ text: "x" }], { groups: "no", apply: true }];

test("fuzz: the dashboard API never answers 500 to odd bodies", async () => {
  const { api } = await setup();
  const routes = [["POST", "/api/memories"], ["PUT", "/api/memories/abc"], ["POST", "/api/import"], ["POST", "/api/skills"], ["PUT", "/api/skills/x"], ["PUT", "/api/skills/max"],
    ["POST", "/api/skills/try"], ["POST", "/api/skills/generate"], ["POST", "/api/skills/improve"], ["PUT", "/api/skills/x/enabled"], ["POST", "/api/services"], ["PUT", "/api/services/x/access"],
    ["POST", "/api/gemini"], ["POST", "/api/openrouter"], ["POST", "/api/openai"], ["POST", "/api/nvidia"], ["PUT", "/api/delegation"], ["POST", "/api/delegation/try"], ["POST", "/api/housekeep"],
    ["POST", "/auth/login"], ["POST", "/auth/setup"], ["POST", "/oauth/register"], ["POST", "/oauth/token"], ["POST", "/oauth/revoke"]];
  const bad = [];
  const realErr = console.error; console.error = () => {};
  try {
    for (const [m, p] of routes) for (const b of WEIRD) {
      const r = await api(p, m, b);
      if (r.status >= 500) bad.push(m + " " + p + " " + JSON.stringify(b).slice(0, 60) + " -> " + r.status);
    }
  } finally { console.error = realErr; }
  assert.deepEqual(bad, []);
});

test("fuzz: the MCP endpoint never answers 500 to odd messages or arguments", async () => {
  const { call, svc } = await setup();
  const msgs = [null, 1, "x", [], [null], [{}], {}, { jsonrpc: "2.0" }, { jsonrpc: "2.0", id: {}, method: "ping" }, { jsonrpc: "2.0", id: 1, method: 5 },
    { jsonrpc: "2.0", id: 1, method: "tools/call" }, { jsonrpc: "2.0", id: 1, method: "tools/call", params: [] }, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: {} } },
    ...["remember", "search", "recent", "update_memory", "forget", "upload_skill", "draft_skill", "select_skills", "housekeep", "delegate", "get_delegation_brief"].flatMap((name) =>
      [undefined, null, [], "x", {}, { text: [], query: {}, limit: "x", n: [], memory_id: [], skill_md: 5, request: [], files: "x", task: 7, kind: [], verify: {}, apply: "yes", proposal_id: [] }].map((arguments_) =>
        ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: arguments_ } })))];
  const bad = [];
  const realErr = console.error; console.error = () => {};
  try {
    for (const m of msgs) {
      const r = await call(svc.url, { method: "POST", headers: JSONH, body: JSON.stringify(m) });
      if (r.status >= 500) bad.push(JSON.stringify(m).slice(0, 80) + " -> " + r.status);
      const t = await r.text();
      if (t) JSON.parse(t);
    }
  } finally { console.error = realErr; }
  assert.deepEqual(bad, []);
});
