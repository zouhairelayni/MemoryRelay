import test from "node:test";
import assert from "node:assert/strict";
import { createD1 } from "./helpers/d1.js";
import worker from "../worker/index.js";
import { resetSchemaCache } from "../worker/db.js";
import { rateLimit } from "../worker/limits.js";
import { parseSkill, updateSkill, getSkill, revertSkill, addSkill } from "../worker/skills.js";
import { generateSkill, improveSkill } from "../worker/skillstudio.js";
import { validateArgs } from "../worker/mcp.js";
import { fetchIdle } from "../worker/aifetch.js";

const JSONH = { "content-type": "application/json" };
const SKILL = (name, desc, body = "Do the thing.") => `---\nname: ${name}\ndescription: ${desc}\n---\n${body}\n`;

const FULL = (name, desc) => SKILL(name, desc, "# Title\n\n## When to use\n- a case\n\n## Steps\n1. do it\n\n## Rules\n- be brief\n\n## Output\n- text\n\n## Example\nsample");

async function setup(extraEnv = {}) {
  resetSchemaCache();
  const { db, DB } = createD1();
  const env = { DB, ASSETS: { fetch: async () => new Response("app") }, ...extraEnv };
  const ctx = { waitUntil: (p) => p };
  const call = (path, init) => worker.fetch(new Request("http://localhost" + path, init), env, ctx);
  const r = await call("/auth/setup", { method: "POST", headers: JSONH, body: JSON.stringify({ email: "o@x.io", password: "longenough12", setup_token: extraEnv.SETUP_TOKEN }) });
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  const api = (p, method = "GET", b) => call(p, { method, headers: { cookie, ...JSONH }, body: b ? JSON.stringify(b) : undefined });
  const svc = (await (await api("/api/services")).json()).services[0];
  const rpc = async (method, params, id = 1, headers = {}) => call(svc.url, { method: "POST", headers: { ...JSONH, ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
  const mcp = async (name, args) => (await (await rpc("tools/call", { name, arguments: args })).json()).result;
  return { db, env, call, api, rpc, mcp, svc, cookie };
}

// Replaces fetch for AI providers with a scripted list of answers (strings or Response-like).
async function withAI(answers, fn) {
  const real = globalThis.fetch; let i = 0;
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes("generativelanguage")) return real(url, init);
    const a = answers[Math.min(i++, answers.length - 1)];
    if (typeof a === "number") return new Response("err", { status: a });
    return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: a }] } }] }), { status: 200 });
  };
  try { return await fn(() => i); } finally { globalThis.fetch = real; }
}
const addKey = (api) => api("/api/gemini", "POST", { op: "add_key", label: "k", key: "AIzaTEST" });

test("an agent cannot turn a memory into a protected rule or fake its source", async () => {
  const { db, mcp } = await setup();
  const id = (await mcp("remember", { text: "plain fact", source: "owner" })).content[0].text.replace("saved ", "");
  assert.match((await mcp("update_memory", { memory_id: id, tags: "rules" })).content[0].text, /reserved/);
  assert.match((await mcp("update_memory", { memory_id: id, tags: "x, Rules" })).content[0].text, /reserved/);
  const row = db.prepare("SELECT tags, source FROM memories WHERE id = ?").get(id);
  assert.equal(row.tags, "");
  assert.match(row.source, /^agent:/);
  assert.match((await mcp("remember", { text: "n", tags: "a,b,c,d,e,f" })).content[0].text, /at most 5/);
});

test("search treats % and _ as plain text and survives huge queries", async () => {
  const { mcp } = await setup();
  await mcp("remember", { text: "alpha one" });
  await mcp("remember", { text: "beta two" });
  const r = JSON.parse((await mcp("search", { query: "%" })).content[0].text);
  assert.equal(r.total, 0);
  const many = JSON.parse((await mcp("search", { query: Array.from({ length: 300 }, (_, i) => "w" + i).join(" ") })).content[0].text);
  assert.equal(many.total, 0);
});

test("MCP: bad JSON, bad shape, unknown tool, bad arguments", async () => {
  const { call, svc, rpc, mcp } = await setup();
  const bad = await call(svc.url, { method: "POST", headers: JSONH, body: "{nope" });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, -32700);
  const arr = await call(svc.url, { method: "POST", headers: JSONH, body: "42" });
  assert.equal((await arr.json()).error.code, -32600);
  assert.equal((await (await rpc("tools/call", { name: "nope", arguments: {} })).json()).error.code, -32602);
  assert.match((await mcp("search", {})).content[0].text, /missing required argument: query/);
  assert.match((await mcp("search", { query: 5 })).content[0].text, /must be a string/);
  assert.equal(validateArgs({ properties: { n: { type: "integer" } } }, { n: "7" }).args.n, 7);
  assert.equal((await call(svc.url, { method: "POST", headers: JSONH, body: "x".repeat(300000) })).status, 413);
});

test("MCP: protocol negotiation, notifications and batches", async () => {
  const { call, svc, rpc } = await setup();
  assert.equal((await (await rpc("initialize", { protocolVersion: "2025-03-26" })).json()).result.protocolVersion, "2025-03-26");
  assert.equal((await (await rpc("initialize", { protocolVersion: "1999-01-01" })).json()).result.protocolVersion, "2025-06-18");
  const note = await call(svc.url, { method: "POST", headers: JSONH, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  assert.equal(note.status, 202);
  const batch = await call(svc.url, { method: "POST", headers: JSONH, body: JSON.stringify([
    { jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 2, method: "tools/list" }]) });
  const out = await batch.json();
  assert.equal(out.length, 2);
  assert.ok(out[1].result.tools.find((t) => t.name === "draft_skill").annotations);
});

test("MCP: secrets with a wrong shape and browser requests are refused", async () => {
  const { call, svc } = await setup();
  assert.equal((await call("/mcp/short", { method: "POST", body: "{}" })).status, 404);
  const r = await call(svc.url, { method: "POST", headers: { ...JSONH, origin: "https://evil.example" }, body: "{}" });
  assert.equal(r.status, 403);
});

test("rate limit: counts inside a window and restarts after it", async () => {
  const { env } = await setup();
  for (let i = 1; i <= 3; i++) assert.equal((await rateLimit(env, "k", 3, 60000)).ok, true);
  assert.equal((await rateLimit(env, "k", 3, 60000)).ok, false);
  env.DB.prepare("UPDATE rate_limits SET expires = 1 WHERE key = 'k'").run();
  assert.equal((await rateLimit(env, "k", 3, 60000)).ok, true);
});

test("errors never leak internals to the client", async () => {
  resetSchemaCache();
  const env = { DB: { batch: async () => { throw new Error("SECRET-INTERNAL-DETAIL"); }, prepare: () => { throw new Error("SECRET-INTERNAL-DETAIL"); } } };
  const real = console.error; console.error = () => {};
  try {
    const r = await worker.fetch(new Request("http://localhost/auth/status"), env, { waitUntil: () => {} });
    assert.equal(r.status, 500);
    assert.doesNotMatch(await r.text(), /SECRET/);
  } finally { console.error = real; }
});

test("agents can only apply a housekeeping proposal they have seen", async () => {
  const { mcp, api } = await setup();
  await mcp("remember", { text: "Likes strong black coffee every morning" });
  await mcp("remember", { text: "Drinks strong black coffee each morning" });
  await addKey(api);
  assert.match((await mcp("housekeep", { apply: true })).content[0].text, /proposal_id/);
  const ids = JSON.parse((await mcp("recent", { n: 5 })).content[0].text).results.map((m) => m.id);
  await withAI([JSON.stringify({ groups: [{ keep: ids[0], drop: [ids[1]], merged_text: "Drinks strong black coffee in the morning", reason: "same" }] })], async () => {
    const dry = JSON.parse((await mcp("housekeep", {})).content[0].text);
    assert.ok(dry.proposal_id);
    assert.match((await mcp("housekeep", { apply: true, proposal_id: "wrong" })).content[0].text, /proposal_id/);
    const done = JSON.parse((await mcp("housekeep", { apply: true, proposal_id: dry.proposal_id })).content[0].text);
    assert.equal(done.removed, 1);
    assert.match((await mcp("housekeep", { apply: true, proposal_id: dry.proposal_id })).content[0].text, /proposal_id/, "a proposal works once");
  });
});

test("skill parsing: folded descriptions, 'should be used when', reserved names", () => {
  const folded = parseSkill("---\nname: pdf-tips\ndescription: >\n  This skill should be used when\n  filling PDF forms.\n---\nSteps here.");
  assert.equal(folded.description, "This skill should be used when filling PDF forms.");
  assert.equal(parseSkill("```markdown\n" + SKILL("fenced", "Use when fencing.") + "```").name, "fenced");
  assert.throws(() => parseSkill(SKILL("max", "Use when testing.")), /reserved/);
  assert.throws(() => parseSkill("---\nname: no-body\ndescription: Use when testing.\n---\n"), /no instructions/);
});

test("agent uploads: hidden characters are refused and the pending queue is capped", async () => {
  const { env, mcp } = await setup();
  const hidden = JSON.parse((await mcp("upload_skill", { skill_md: SKILL("sneaky", "Use when testing.", "Do it.\u202E hidden") })).content[0].text);
  assert.match(hidden.error, /hidden/);
  for (let i = 0; i < 20; i++) assert.ok((await addSkill(env, SKILL("a" + i, "Use when testing " + i + "."), "agent:x")).ok);
  assert.match((await addSkill(env, SKILL("one-more", "Use when testing."), "agent:x")).error, /too many/);
});

test("owner edits: name stays, previous version is kept, undo works", async () => {
  const { env, api } = await setup();
  await api("/api/skills", "POST", { text: SKILL("editable", "Use when editing.", "Version one.") });
  assert.equal((await updateSkill(env, "editable", SKILL("other", "Use when editing."))).error.includes("must stay"), true);
  const r = await (await api("/api/skills/editable", "PUT", { text: SKILL("editable", "Use when editing more.", "Version two.") })).json();
  assert.equal(r.versions, 1);
  assert.match((await getSkill(env, "editable")).text, /Version two/);
  assert.match((await revertSkill(env, "editable")).text, /Version one/);
  assert.match((await revertSkill(env, "editable")).text, /Version two/, "undo can be undone");
  assert.equal((await api("/api/skills/missing")).status, 404);
  assert.equal((await api("/api/skills/max", "PUT", { max: 4 })).status, 200, "settings route is not shadowed by edit");
  await api("/api/skills/editable", "DELETE");
  assert.equal((await getSkill(env, "editable")).error, "skill not found");
});

test("Skill Studio: generates a valid draft and saves nothing", async () => {
  const { env, api, db } = await setup();
  await addKey(api);
  const draft = "```markdown\n" + FULL("weekly-report", "Use when writing the weekly status report.") + "```";
  await withAI([draft], async () => {
    const r = await (await api("/api/skills/generate", "POST", { goal: "write the weekly status report from notes" })).json();
    assert.equal(r.name, "weekly-report");
    assert.match(r.text, /^---\nname: weekly-report/);
    assert.equal(r.repaired, false);
  });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM skills WHERE source NOT LIKE 'builtin%'").get().n, 0);
  assert.match((await generateSkill(env, { goal: "x" })).error, /Describe/);
});

test("Skill Studio: an invalid draft is repaired once, then refused", async () => {
  const { env, api } = await setup();
  await addKey(api);
  await withAI(["no header at all", FULL("fixed-skill", "Use when fixing.")], async (count) => {
    const r = await generateSkill(env, { goal: "something that needs fixing" });
    assert.equal(r.repaired, true);
    assert.equal(r.name, "fixed-skill");
    assert.equal(count(), 2);
  });
  await withAI(["still nothing"], async () => {
    assert.match((await generateSkill(env, { goal: "something that never works" })).error, /not valid/);
  });
});

test("Skill Studio: edits keep the name and report what changed; no key gives a clear error", async () => {
  const { env, api } = await setup();
  const none = await improveSkill(env, { text: SKILL("keep-me", "Use when keeping."), instruction: "add a rule" });
  assert.match(none.error, /did not answer/);
  await addKey(api);
  await withAI([SKILL("renamed-by-ai", "Use when keeping.", "Do the thing.\nNew rule: be brief.")], async () => {
    const r = await improveSkill(env, { text: SKILL("keep-me", "Use when keeping."), instruction: "add a rule about brevity" });
    assert.equal(r.name, "keep-me");
    assert.match(r.text, /name: keep-me/);
    assert.ok(r.added >= 1);
  });
});

test("MCP draft_skill returns a draft that still needs upload_skill and owner approval", async () => {
  const { api, mcp } = await setup();
  await addKey(api);
  await withAI([FULL("agent-draft", "Use when drafting.")], async () => {
    const r = JSON.parse((await mcp("draft_skill", { goal: "a skill for drafting release notes" })).content[0].text);
    assert.match(r.skill_md, /agent-draft/);
    assert.match(r.next, /upload_skill/);
  });
  assert.equal((await (await api("/api/skills")).json()).skills.filter((x) => !x.source.startsWith("builtin")).length, 0);
});

test("SETUP_TOKEN: the first account needs it when it is configured", async () => {
  resetSchemaCache();
  const { DB } = createD1();
  const env = { DB, SETUP_TOKEN: "s3cret-token", ASSETS: { fetch: async () => new Response("") } };
  const post = (b) => worker.fetch(new Request("http://localhost/auth/setup", { method: "POST", headers: JSONH, body: JSON.stringify({ email: "o@x.io", password: "longenough12", ...b }) }), env, { waitUntil: () => {} });
  assert.equal((await post({})).status, 403);
  assert.equal((await post({ setup_token: "wrong" })).status, 403);
  assert.equal((await post({ setup_token: "s3cret-token" })).status, 200);
  const st = await (await worker.fetch(new Request("http://localhost/auth/status"), env, { waitUntil: () => {} })).json();
  assert.equal(st.setup_token, true);
});

test("import: bad ids and broken history cannot poison the table", async () => {
  const { api, mcp } = await setup();
  await api("/api/import", "POST", [{ id: "x/../y", text: "imported one", history: "{not json", tags: "A , a" }]);
  const m = JSON.parse((await mcp("search", { query: "imported" })).content[0].text).results[0];
  assert.match(m.id, /^[a-f0-9]{12}$/);
  assert.match((await mcp("update_memory", { memory_id: m.id, text: "imported two" })).content[0].text, /^updated/);
  assert.equal(m.tags, "a");
});

test("Skill Studio: a generated skill must follow the template sections", async () => {
  const { env, api } = await setup();
  await addKey(api);
  await withAI([SKILL("thin-skill", "Use when thin.", "Just one paragraph."), FULL("thin-skill", "Use when thin.")], async (count) => {
    const r = await generateSkill(env, { goal: "a skill that starts without sections" });
    assert.equal(r.repaired, true);
    assert.match(r.text, /## Steps/);
    assert.equal(count(), 2);
  });
  await withAI([SKILL("thin-skill", "Use when thin.", "Just one paragraph.")], async () => {
    assert.match((await generateSkill(env, { goal: "a skill that never gets sections" })).error, /Missing sections/);
  });
  // an edit only has to keep the sections the skill already had
  await withAI([SKILL("plain", "Use when plain.", "Do the thing.\nExtra line.")], async () => {
    assert.ok((await improveSkill(env, { text: SKILL("plain", "Use when plain."), instruction: "add an extra line" })).text);
  });
});

function stream(chunks, gap, hangAfter = false) {
  return new ReadableStream({ async start(c) {
    for (const x of chunks) { await new Promise((r) => setTimeout(r, gap)); c.enqueue(new TextEncoder().encode(x)); }
    if (!hangAfter) c.close();
  } });
}
test("AI watchdog: output that keeps flowing is never cut off, silence is", async () => {
  const real = globalThis.fetch;
  const t = { firstMs: 120, idleMs: 120, totalMs: 3000 };
  try {
    // 8 chunks, 50ms apart = 400ms in total: far longer than idleMs, but never silent for 120ms
    globalThis.fetch = async () => new Response(stream(["a", "b", "c", "d", "e", "f", "g", "h"], 50));
    assert.equal(await (await fetchIdle("http://x", {}, t)).text(), "abcdefgh");
    // slow start: the model thinks for 80ms before answering, inside firstMs
    globalThis.fetch = async () => { await new Promise((r) => setTimeout(r, 80)); return new Response("done"); };
    assert.equal(await (await fetchIdle("http://x", {}, t)).text(), "done");
    // stalls after the first chunk
    globalThis.fetch = async () => new Response(stream(["a"], 10, true));
    await assert.rejects(fetchIdle("http://x", {}, t), /stalled/);
    // never starts (the mock honours the abort signal like a real fetch)
    globalThis.fetch = (u, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted"))));
    await assert.rejects(fetchIdle("http://x", {}, t), /sent nothing/);
  } finally { globalThis.fetch = real; }
});

// ---- OAuth ----
const b64url = (buf) => Buffer.from(buf).toString("base64url");
async function oauthFlow(ctx, { access = "write", redirect = "https://app.example/cb" } = {}) {
  const { call } = ctx;
  const reg = await (await call("/oauth/register", { method: "POST", headers: JSONH, body: JSON.stringify({ client_name: "Test App", redirect_uris: [redirect] }) })).json();
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const q = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: "S256", state: "xyz" });
  const consent = await call("/oauth/authorize?" + q, { headers: { cookie: ctx.cookie } });
  const csrfCookie = consent.headers.get("set-cookie").split(";")[0];
  const csrf = (await consent.text()).match(/name="csrf" value="([^"]+)"/)[1];
  const browserCookie = ctx.cookie + "; " + csrfCookie;
  // The signed browser posts both its session cookie and the form's CSRF cookie.
  const approve = (extra = {}, headers = {}) => call("/oauth/authorize", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie: browserCookie, ...headers },
    body: new URLSearchParams({ csrf, client_id: reg.client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: "S256", state: "xyz", step: "consent", name: "OAuth agent", access, decision: "approve", ...extra }) });
  const exchange = async (code, v = verifier) => call("/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirect, client_id: reg.client_id, code_verifier: v }) });
  return { reg, q, approve, exchange, verifier, redirect, challenge, csrf, csrfCookie, browserCookie };
}
const codeOf = (res) => new URL(res.headers.get("location")).searchParams.get("code");

test("OAuth: discovery documents and the 401 challenge", async () => {
  const { call } = await setup();
  const res = await (await call("/.well-known/oauth-authorization-server")).json();
  assert.deepEqual(res.code_challenge_methods_supported, ["S256"]);
  assert.match(res.token_endpoint, /\/oauth\/token$/);
  const pr = await (await call("/.well-known/oauth-protected-resource")).json();
  assert.match(pr.resource, /\/mcp$/);
  assert.equal((await call("/.well-known/oauth-protected-resource/mcp")).status, 200);
  const r = await call("/mcp", { method: "POST", headers: JSONH, body: "{}" });
  assert.equal(r.status, 401);
  assert.match(r.headers.get("www-authenticate"), /resource_metadata=".*oauth-protected-resource"/);
  assert.equal((await call("/mcp", { method: "OPTIONS" })).status, 204);
});

test("OAuth: register rejects unsafe redirect addresses", async () => {
  const { call } = await setup();
  const reg = (uris) => call("/oauth/register", { method: "POST", headers: JSONH, body: JSON.stringify({ redirect_uris: uris }) });
  for (const bad of ["javascript:alert(1)", "http://evil.example/cb", "https://a.example/cb#frag", "data:text/html,x", "nonsense"]) assert.equal((await reg([bad])).status, 400, bad);
  assert.equal((await reg(["http://127.0.0.1:8123/cb"])).status, 201);
  assert.equal((await reg(["claude://callback"])).status, 201);
});

test("OAuth: full sign-in, token use, refresh rotation and reuse detection", async () => {
  const ctx = await setup();
  const f = await oauthFlow(ctx);
  const page = await ctx.call("/oauth/authorize?" + f.q, { headers: { cookie: ctx.cookie } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Connect Test App\?/);
  assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);

  const ok = await f.approve();
  assert.equal(ok.status, 302);
  assert.equal(new URL(ok.headers.get("location")).searchParams.get("state"), "xyz");
  const code = codeOf(ok);

  assert.equal((await f.exchange(code, "x".repeat(50))).status, 400, "wrong PKCE verifier");
  assert.equal((await f.exchange(code)).status, 400, "a code works once, even after a failed try");

  const code2 = codeOf(await f.approve({ name: "Second" }));
  const tok = await (await f.exchange(code2)).json();
  assert.equal(tok.token_type, "Bearer");
  assert.equal(tok.scope, "memory:write");

  const rpc = (method, params, t = tok.access_token) => ctx.call("/mcp", { method: "POST", headers: { ...JSONH, authorization: "Bearer " + t }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  assert.equal((await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "TestApp", version: "1" } })).status, 200);
  assert.equal((await rpc("ping", {}, "mra_" + "0".repeat(64))).status, 401);
  const saved = (await (await rpc("tools/call", { name: "remember", arguments: { text: "from oauth" } })).json()).result.content[0].text;
  assert.match(saved, /^saved/);

  const refresh = (rt) => ctx.call("/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: rt, client_id: f.reg.client_id }) });
  const t2 = await (await refresh(tok.refresh_token)).json();
  assert.ok(t2.access_token && t2.refresh_token !== tok.refresh_token);
  assert.equal((await refresh(tok.refresh_token)).status, 400, "reusing an old refresh token fails");
  assert.equal((await rpc("ping", {}, t2.access_token)).status, 401, "and ends the whole session");
});

test("OAuth: each connection has its own access level, and revoking it ends the sessions", async () => {
  const ctx = await setup();
  const f = await oauthFlow(ctx, { access: "read" });
  const tok = await (await f.exchange(codeOf(await f.approve()))).json();
  const rpc = (method, params) => ctx.call("/mcp", { method: "POST", headers: { ...JSONH, authorization: "Bearer " + tok.access_token }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const names = (await (await rpc("tools/list", {})).json()).result.tools.map((t) => t.name);
  assert.ok(names.includes("search") && !names.includes("remember") && !names.includes("forget"));
  const denied = (await (await rpc("tools/call", { name: "remember", arguments: { text: "nope" } })).json()).result;
  assert.equal(denied.isError, true);
  assert.match(denied.content[0].text, /read only/i);

  const svc = (await (await ctx.api("/api/services")).json()).services.find((s) => s.name === "OAuth agent");
  assert.equal(svc.access, "read");
  assert.equal(svc.sessions, 1);
  assert.equal((await ctx.api("/api/services/" + svc.id + "/access", "PUT", { access: "full" })).status, 200);
  assert.ok((await (await rpc("tools/list", {})).json()).result.tools.some((t) => t.name === "forget"));
  assert.equal((await ctx.api("/api/services/" + svc.id + "/access", "PUT", { access: "root" })).status, 400);
  await ctx.api("/api/services/" + svc.id + "/revoke", "POST");
  assert.equal((await rpc("ping", {})).status, 401);
});

test("OAuth: the secret address also honours the access level, and a denial goes back to the app", async () => {
  const ctx = await setup();
  const made = await (await ctx.api("/api/services", "POST", { name: "Reader", access: "read" })).json();
  const res = await ctx.call(made.url, { method: "POST", headers: JSONH, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "forget", arguments: { memory_id: "x" } } }) });
  assert.match((await res.json()).result.content[0].text, /needs full access/);
  const f = await oauthFlow(ctx);
  const deny = await f.approve({ decision: "deny" });
  assert.equal(new URL(deny.headers.get("location")).searchParams.get("error"), "access_denied");
  const bad = await ctx.call("/oauth/authorize?" + new URLSearchParams({ client_id: f.reg.client_id, redirect_uri: "https://evil.example/cb", response_type: "code", code_challenge: "a".repeat(43) }));
  assert.equal(bad.status, 400);
  assert.equal(bad.headers.get("location"), null);
});

// ---- OAuth sign-in and approval flow ----
const FORM = { "content-type": "application/x-www-form-urlencoded" };
const login = (ctx, f, pw = "longenough12", extra = {}) => ctx.call("/oauth/authorize", { method: "POST", headers: { ...FORM, cookie: f.csrfCookie },
  body: new URLSearchParams({ csrf: f.csrf, client_id: f.reg.client_id, redirect_uri: f.redirect, code_challenge: f.challenge, code_challenge_method: "S256", state: "xyz", step: "login", email: "o@x.io", password: pw, ...extra }) });

test("OAuth page: a signed-out visitor sees only a sign-in form and nothing about the account", async () => {
  const ctx = await setup();
  await ctx.api("/api/services", "POST", { name: "TopSecretConn", access: "full" });
  const f = await oauthFlow(ctx);
  const res = await ctx.call("/oauth/authorize?" + f.q);            // no cookie
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /Sign in to continue/);
  assert.doesNotMatch(html, /TopSecretConn/);
  assert.doesNotMatch(html, /Full access|Read only|<select/);
  assert.doesNotMatch(html, /name="decision"/, "no approve button before signing in");
  const before = ctx.db.prepare("SELECT COUNT(*) AS n FROM oauth_codes").get().n;
  const post = await f.approve({}, { cookie: f.csrfCookie });       // valid CSRF but no login session
  assert.equal(post.status, 200);
  assert.equal(post.headers.get("location"), null);
  assert.match(await post.text(), /Sign in to continue/);
  assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM oauth_codes").get().n, before, "no code was issued");
});

test("OAuth sign-in step: wrong password is refused, the right one continues the handshake with a Lax session", async () => {
  const ctx = await setup();
  const f = await oauthFlow(ctx);
  const bad = await login(ctx, f, "not-the-password");
  assert.equal(bad.status, 401);
  assert.equal(bad.headers.get("set-cookie"), null);
  const good = await login(ctx, f);
  assert.equal(good.status, 302);
  const loc = new URL(good.headers.get("location"));
  assert.equal(loc.pathname, "/oauth/authorize");
  assert.equal(loc.searchParams.get("client_id"), f.reg.client_id);
  const cookie = good.headers.get("set-cookie");
  assert.match(cookie, /__Host-sid=/);
  assert.match(cookie, /SameSite=Lax/, "so the browser sends it when an app links here");
  const consent = await ctx.call(loc.pathname + loc.search, { headers: { cookie: cookie.split(";")[0] } });
  assert.match(await consent.text(), /Connect Test App\?/);
});

test("OAuth approval: no password, no list of other connections, new connection by default", async () => {
  const ctx = await setup();
  await ctx.api("/api/services", "POST", { name: "OldConnection", access: "write" });
  const f = await oauthFlow(ctx);
  const html = await (await ctx.call("/oauth/authorize?" + f.q, { headers: { cookie: ctx.cookie } })).text();
  assert.match(html, /New connection/);
  assert.doesNotMatch(html, /type="password"/);
  assert.doesNotMatch(html, /OldConnection|<select/);
  const before = ctx.db.prepare("SELECT COUNT(*) AS n FROM services").get().n;
  const ok = await f.approve({ name: "Fresh one", access: "read" });
  assert.equal(ok.status, 302);
  assert.ok(codeOf(ok));
  assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM services").get().n, before + 1);
  const made = ctx.db.prepare("SELECT name, access FROM services WHERE name = 'Fresh one'").get();
  assert.equal(made.access, "read");
});

test("OAuth: every handshake is new; the same app coming back refreshes its own connection", async () => {
  const ctx = await setup();
  const count = () => ctx.db.prepare("SELECT COUNT(*) AS n FROM services").get().n;
  const a = await oauthFlow(ctx);                       // "Test App" at app.example
  const start = count();
  assert.ok(codeOf(await a.approve()));
  assert.equal(count(), start + 1, "first time: a new connection");
  const again = await oauthFlow(ctx);                   // same app name, same site, registered again
  const page = await (await ctx.call("/oauth/authorize?" + again.q, { headers: { cookie: ctx.cookie } })).text();
  assert.match(page, /Refreshing an existing connection/);
  assert.match(page, /Reconnect Test App\?/);
  assert.ok(codeOf(await again.approve()));
  assert.equal(count(), start + 1, "refresh: no second connection");
  assert.ok(codeOf(await again.approve({ decision: "new" })));
  assert.equal(count(), start + 2, "asking for a separate one creates it");
  const other = await oauthFlow(ctx, { redirect: "https://other.example/cb" });   // same name, different site: not a refresh
  assert.match(await (await ctx.call("/oauth/authorize?" + other.q, { headers: { cookie: ctx.cookie } })).text(), /New connection/);
  const names = ctx.db.prepare("SELECT name FROM services WHERE name LIKE 'OAuth agent%' OR name LIKE 'Test App%'").all().map((r) => r.name);
  assert.equal(new Set(names).size, names.length, "names stay unique");
});

test("OAuth consent accepts valid CSRF even from embedded app browsers; forged submissions are refused", async () => {
  const ctx = await setup();
  const f = await oauthFlow(ctx);
  const page = await ctx.call("/oauth/authorize?" + f.q, { headers: { cookie: ctx.cookie } });
  assert.equal(page.headers.get("referrer-policy"), "same-origin");
  // A browser may report Origin:null or Sec-Fetch-Site:cross-site after external-app redirects.
  // The unguessable double-submit cookie still proves that this form was displayed by this server.
  const f2 = await oauthFlow(ctx);
  assert.equal((await f2.approve({}, { origin: "null", "sec-fetch-site": "cross-site" })).status, 302);
  assert.equal((await f2.approve({}, { origin: "https://evil.example" })).status, 302);
  assert.equal((await f2.approve({ csrf: "x" })).status, 403);
  assert.equal((await f2.approve({}, { cookie: ctx.cookie })).status, 403);
  const forged = await ctx.call("/oauth/authorize", { method: "POST", headers: FORM,
    body: new URLSearchParams({ ...Object.fromEntries(f2.q), step: "consent", decision: "approve" }) });
  assert.equal(forged.status, 403);
});

test("OAuth consent CSP permits only the registered external callback after form submission", async () => {
  const ctx = await setup();
  const f = await oauthFlow(ctx, { redirect: "https://claude.ai/api/mcp/auth_callback" });
  const consent = await ctx.call("/oauth/authorize?" + f.q, { headers: { cookie: ctx.cookie } });
  const csp = consent.headers.get("content-security-policy");
  assert.match(csp, /form-action 'self' https:\/\/claude\.ai(?:;|$)/);
  assert.doesNotMatch(csp.split("form-action")[1], /unsafe-inline|evil\.example/);
  assert.match(csp, /default-src 'none'/);
  const approved = await f.approve();
  assert.equal(approved.status, 302);
  assert.equal(new URL(approved.headers.get("location")).origin, "https://claude.ai");
  const custom = await oauthFlow(ctx, { redirect: "claude://callback" });
  const customConsent = await ctx.call("/oauth/authorize?" + custom.q, { headers: { cookie: ctx.cookie } });
  assert.match(customConsent.headers.get("content-security-policy"), /form-action 'self' claude:(?:;|$)/);
  const login = await ctx.call("/oauth/authorize?" + f.q); // without a session cookie
  assert.match(login.headers.get("content-security-policy"), /form-action 'self'(?:;|$)/);
});

test("OAuth page shows the connecting app's logo and the M mark", async () => {
  const ctx = await setup();
  for (const [name, mark] of [["Claude", "#D97757"], ["ChatGPT", "#10A37F"], ["Gemini CLI", "mr-gem"]]) {
    const reg = await (await ctx.call("/oauth/register", { method: "POST", headers: JSONH, body: JSON.stringify({ client_name: name, redirect_uris: ["https://app.example/cb"] }) })).json();
    const q = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: "https://app.example/cb", code_challenge: "a".repeat(43), code_challenge_method: "S256" });
    const html = await (await ctx.call("/oauth/authorize?" + q, { headers: { cookie: ctx.cookie } })).text();
    assert.ok(html.includes(mark), name + " mark");
    assert.ok(html.includes('rx="7.2" fill="#2F54EB"'), "the M logo tile");
  }
});

test("brand detection from a connection name or what the app reports", async () => {
  const { detectBrand } = await import("../shared/brands.js");
  assert.equal(detectBrand("My Claude", ""), "claude");
  assert.equal(detectBrand("Work", "openai-mcp 1.0"), "chatgpt");
  assert.equal(detectBrand("", "gemini-cli 0.9"), "gemini");
  assert.equal(detectBrand("Editor", "Cursor"), "cursor");
  assert.equal(detectBrand("Home server", "some-tool 1.0"), "");
});

test("the dashboard session cookie is Lax", async () => {
  const ctx = await setup();
  const r = await ctx.call("/auth/login", { method: "POST", headers: JSONH, body: JSON.stringify({ email: "o@x.io", password: "longenough12" }) });
  assert.match(r.headers.get("set-cookie"), /SameSite=Lax/);
  assert.match(r.headers.get("set-cookie"), /HttpOnly/);
});
