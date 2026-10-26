import test from "node:test";
import assert from "node:assert/strict";
import { createD1 } from "./helpers/d1.js";
import worker from "../worker/index.js";
import { resetSchemaCache } from "../worker/db.js";
import { checkAnswer, findSecrets, MAX_IN_TOKENS } from "../worker/delegate.js";

const JSONH = { "content-type": "application/json" };

async function setup() {
  resetSchemaCache();
  const { db, DB } = createD1();
  const env = { DB, ASSETS: { fetch: async () => new Response("app") } };
  const ctx = { waitUntil: (p) => p };
  const call = (path, init) => worker.fetch(new Request("http://localhost" + path, init), env, ctx);
  const r = await call("/auth/setup", { method: "POST", headers: JSONH, body: JSON.stringify({ email: "o@x.io", password: "longenough12" }) });
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  const api = (p, method = "GET", b) => call(p, { method, headers: { cookie, ...JSONH }, body: b ? JSON.stringify(b) : undefined });
  const svc = (await (await api("/api/services")).json()).services[0];
  const mcp = async (name, args, url = svc.url) => (await (await call(url, { method: "POST", headers: JSONH, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()).result;
  return { db, env, api, mcp, svc, call };
}

// Scripted AI providers. `seen` records every call so tests can check what was sent where.
async function withProviders(handlers, fn) {
  const real = globalThis.fetch, seen = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    const key = Object.keys(handlers).find((k) => u.includes(k));
    if (!key) return real(url, init);
    const body = init && init.body ? JSON.parse(init.body) : null;
    seen.push({ url: u, body, headers: init && init.headers });
    return handlers[key](body, u);
  };
  try { return await fn(seen); } finally { globalThis.fetch = real; }
}
const chat = (text) => () => new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: "stop" }] }), { status: 200 });
const gem = (text) => () => new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] }), { status: 200 });

async function pool(api) {
  await api("/api/gemini", "POST", { op: "add_key", label: "g", key: "AIzaGEMINI" });
  await api("/api/gemini", "POST", { op: "add_model", name: "gemini-fast" });
  await api("/api/openrouter", "POST", { op: "add_key", label: "o", key: "sk-or-v1-AAA" });
  await api("/api/openrouter", "POST", { op: "add_model", name: "x/free:free" });
}

test("OpenAI and NVIDIA keys: each provider checks its own key format", async () => {
  const { api } = await setup();
  assert.equal((await api("/api/openai", "POST", { op: "add_key", key: "sk-or-v1-THISISOPENROUTER" })).status, 400);
  assert.equal((await api("/api/openai", "POST", { op: "add_key", key: "AIzaNO" })).status, 400);
  const ok = await api("/api/openai", "POST", { op: "add_key", label: "main", key: "sk-proj-ABCDEFGH" });
  assert.equal((await ok.json()).keys[0].tail, "EFGH");
  assert.equal((await api("/api/nvidia", "POST", { op: "add_key", key: "sk-wrong" })).status, 400);
  assert.equal((await (await api("/api/nvidia", "POST", { op: "add_key", key: "nvapi-ABCDWXYZ" })).json()).keys.length, 1);
  assert.equal((await api("/api/openai", "POST", { op: "add_key", key: "sk-has space inside" })).status, 400);
  // keys and models are separate per provider
  assert.equal((await (await api("/api/openai")).json()).keys.length, 1);
  assert.equal((await (await api("/api/openrouter")).json()).keys.length, 0);
});

test("OpenAI and NVIDIA: model lists keep chat models only; OpenAI uses its own token parameter", async () => {
  const { env, api } = await setup();
  await api("/api/openai", "POST", { op: "add_key", key: "sk-proj-LISTKEY0001" });
  await api("/api/nvidia", "POST", { op: "add_key", key: "nvapi-LISTKEY0001" });
  await withProviders({
    "api.openai.com/v1/models": () => new Response(JSON.stringify({ data: [{ id: "gpt-4.1" }, { id: "text-embedding-3-small" }, { id: "o4-mini" }, { id: "whisper-1" }, { id: "gpt-4o-audio-preview" }, { id: "dall-e-3" }] })),
    "integrate.api.nvidia.com/v1/models": () => new Response(JSON.stringify({ data: [{ id: "meta/llama-3.3-70b-instruct" }, { id: "nvidia/nv-embedqa-e5-v5" }, { id: "nvidia/llama-3.1-nemoguard-8b-content-safety" }] })),
  }, async () => {
    assert.deepEqual((await (await api("/api/openai/models")).json()).models.map((m) => m.id), ["gpt-4.1", "o4-mini"]);
    assert.deepEqual((await (await api("/api/nvidia/models")).json()).models.map((m) => m.id), ["meta/llama-3.3-70b-instruct"]);
  });
  await api("/api/openai", "POST", { op: "add_model", name: "gpt-4.1" });
  const { openai } = await import("../worker/providers.js");
  await withProviders({ "api.openai.com/v1/chat/completions": chat("hello") }, async (seen) => {
    const r = await openai.call(env, "hi", { system: "be brief", maxTokens: 321, temperature: 0.2 });
    assert.equal(r.text, "hello");
    assert.equal(seen[0].body.max_completion_tokens, 321);
    assert.equal(seen[0].body.max_tokens, undefined);
    assert.equal(seen[0].body.messages[0].role, "system");
  });
});

test("delegate: a connection with write access gets the sub-agent's answer", async () => {
  const { api, mcp, db } = await setup();
  await pool(api);
  await withProviders({ "generativelanguage": gem("```js\nconst add = (a, b) => a + b;\n```") }, async (seen) => {
    const r = await mcp("delegate", { task: "write an add function in JavaScript", kind: "function", language: "javascript" });
    assert.ok(!r.isError, r.content[0].text);
    assert.match(r.content[0].text, /const add/);
    assert.match(r.content[0].text, /-- sub-agent: Gemini \/ \S+ \(~\d+ tokens in/);
    assert.match(seen[0].url, /streamGenerateContent/, "long jobs stream so slow answers are not cut off");
    assert.match(JSON.stringify(seen[0].body), /sub-agent/);
    assert.match(JSON.stringify(seen[0].body), /one complete function/);
  });
  const row = db.prepare("SELECT * FROM delegations").get();
  assert.equal(row.ok, 1);
  assert.equal(row.provider, "gemini");
  assert.ok(!JSON.stringify(row).includes("add function"), "the log never stores the request text");
});

test("delegate: requests spread over providers, and fall back when one fails", async () => {
  const { api, mcp } = await setup();
  await pool(api);
  await withProviders({ "generativelanguage": gem("from gemini"), "openrouter.ai/api/v1/chat/completions": chat("from openrouter") }, async () => {
    const names = [];
    for (let i = 0; i < 4; i++) names.push((await mcp("delegate", { task: "write a snippet number " + i, kind: "snippet" })).content[0].text.match(/sub-agent: (\w+)/)[1]);
    assert.deepEqual([...new Set(names)].sort(), ["Gemini", "OpenRouter"]);
    assert.notEqual(names[0], names[1], "each request starts at the next provider");
  });
  await withProviders({ "generativelanguage": () => new Response("down", { status: 400 }), "openrouter.ai/api/v1/chat/completions": chat("backup answer") }, async () => {
    for (let i = 0; i < 2; i++) assert.match((await mcp("delegate", { task: "write something useful " + i })).content[0].text, /backup answer/);
  });
  await api("/api/delegation", "PUT", { strategy: "order" });
  await withProviders({ "generativelanguage": gem("first in order"), "openrouter.ai/api/v1/chat/completions": chat("second") }, async () => {
    for (let i = 0; i < 3; i++) assert.match((await mcp("delegate", { task: "write something useful " + i })).content[0].text, /first in order/);
  });
});

test("delegate: OpenAI is paid, so it is used only when asked for (or added to the order)", async () => {
  const { api, mcp } = await setup();
  await pool(api);
  await api("/api/openai", "POST", { op: "add_key", key: "sk-proj-PAIDKEY0001" });
  await api("/api/openai", "POST", { op: "add_model", name: "gpt-4.1-mini" });
  await withProviders({ "generativelanguage": gem("g"), "openrouter.ai/api/v1/chat/completions": chat("o"), "api.openai.com/v1/chat/completions": chat("paid") }, async () => {
    for (let i = 0; i < 6; i++) assert.doesNotMatch((await mcp("delegate", { task: "write something useful " + i })).content[0].text, /paid/);
    assert.match((await mcp("delegate", { task: "write something useful", provider: "openai" })).content[0].text, /paid/);
    assert.match((await mcp("delegate", { task: "write something useful", provider: "openai", model: "gpt-4.1-mini" })).content[0].text, /OpenAI \/ gpt-4.1-mini/);
    assert.match((await mcp("delegate", { task: "write something useful", provider: "openai", model: "gpt-5-pro" })).content[0].text, /not enabled/, "an agent cannot pick a model the owner did not enable");
  });
  await api("/api/delegation", "PUT", { order: ["openai"] });
  await withProviders({ "api.openai.com/v1/chat/completions": chat("now routed to paid") }, async () => {
    assert.match((await mcp("delegate", { task: "write something useful" })).content[0].text, /now routed to paid/);
  });
});

test("delegate: size limit, secrets, kinds, access level, switch and hourly cap", async () => {
  const { api, mcp, call } = await setup();
  await pool(api);
  const big = "word ".repeat(7000);
  assert.match((await mcp("delegate", { task: "review this code", context: big })).content[0].text, new RegExp("limit is " + MAX_IN_TOKENS));
  const justUnder = "ab ".repeat(2400); // about 3100 tokens: allowed
  await withProviders({ "generativelanguage": gem("ok") }, async () => {
    assert.ok(!(await mcp("delegate", { task: "review this code", context: justUnder })).isError);
    const leak = await mcp("delegate", { task: "fix this", context: "const k = 'AIzaSyA1234567890abcdefghijklmnopqrstuvwx';" });
    assert.match(leak.content[0].text, /Google API key/);
    assert.doesNotMatch(leak.content[0].text, /AIzaSyA1234/, "the value is never echoed");
    assert.match((await mcp("delegate", { task: "do something useful", kind: "dance" })).content[0].text, /kind must be one of/);
    assert.match((await mcp("delegate", { task: "short" })).content[0].text, /describe the job/);
  });
  assert.deepEqual(findSecrets("password = 'abcdefghijklmnopqrstuvwxyz123'"), ["a value assigned to a secret-looking name"]);
  assert.deepEqual(findSecrets("just plain code: const x = 1;"), []);

  const ro = await (await api("/api/services", "POST", { name: "Reader", access: "read" })).json();
  const denied = await mcp("delegate", { task: "write something useful" }, ro.url);
  assert.match(denied.content[0].text, /needs read and write/i);

  await api("/api/delegation", "PUT", { per_hour: 3 }); // one call is already counted above
  await withProviders({ "generativelanguage": gem("ok") }, async () => {
    assert.ok(!(await mcp("delegate", { task: "write something useful one" })).isError);
    assert.ok(!(await mcp("delegate", { task: "write something useful two" })).isError);
    assert.match((await mcp("delegate", { task: "write something useful three" })).content[0].text, /limit of 3 sub-agent calls/);
  });
  await api("/api/delegation", "PUT", { enabled: false });
  assert.match((await mcp("delegate", { task: "write something useful again" })).content[0].text, /switched off/);
});

test("delegate settings: validation, usage and no provider ready", async () => {
  const { api, mcp } = await setup();
  assert.match((await mcp("delegate", { task: "write something useful" })).content[0].text, /no AI provider is ready/);
  assert.equal((await api("/api/delegation", "PUT", { per_hour: 0 })).status, 400);
  assert.equal((await api("/api/delegation", "PUT", { strategy: "chaos" })).status, 400);
  assert.equal((await api("/api/delegation", "PUT", { order: ["nonsense"] })).status, 400);
  const s = await (await api("/api/delegation", "PUT", { order: ["nvidia", "gemini", "gemini"], per_hour: 12 })).json();
  assert.deepEqual(s.order, ["nvidia", "gemini"]);
  assert.equal(s.per_hour, 12);
  assert.equal(s.providers.find((p) => p.id === "openai").paid, true);
  assert.equal(s.usage.calls, 0);
  assert.deepEqual(s.recent, []);
});

const GOOD = "## Result\n```js\nexport const add = (a, b) => a + b;\n```\n## Assumptions\n- none\n## Self-check\n- [x] adds two numbers\nSTATUS: COMPLETE";
const PLACEHOLDER_ANSWER = "## Result\n```js\nexport function add(a, b) {\n  // TODO implement\n}\n```\n## Assumptions\n- none\n## Self-check\n- [x] done\nSTATUS: COMPLETE";

test("quality checks: what counts as a problem", () => {
  assert.deepEqual(checkAnswer(GOOD, "function"), { hard: [], soft: [] });
  assert.match(checkAnswer(PLACEHOLDER_ANSWER, "function").hard.join(), /placeholders/);
  assert.match(checkAnswer("Here you go, just do add(a,b)", "function").hard.join(), /no code block/);
  assert.match(checkAnswer(GOOD.replace("```\n## Assumptions", "\n## Assumptions"), "function").hard.join(), /not closed/);
  assert.match(checkAnswer(GOOD.replace("COMPLETE", "BLOCKED"), "function").hard.join(), /STATUS: BLOCKED/);
  assert.match(checkAnswer("I'm sorry, I can't help with that.", "snippet").hard.join(), /refused/);
  assert.match(checkAnswer("```json\n{bad json}\n```\nSTATUS: COMPLETE", "other").hard.join(), /not valid JSON/);
  assert.match(checkAnswer(GOOD, "function", true).hard.join(), /cut off/);
  assert.deepEqual(checkAnswer("The reason is X.\nSTATUS: COMPLETE", "explain").hard, [], "explanations need no code");
  assert.match(checkAnswer("```js\nconst a = 1;\n```", "snippet").soft.join(), /STATUS/);
});

test("the delegation guide: tool, dashboard route and built-in skill", async () => {
  const { api, mcp, call, svc } = await setup();
  const ro = await (await api("/api/services", "POST", { name: "Reader", access: "read" })).json();
  const g = (await mcp("get_delegation_brief", {}, ro.url)).content[0].text;
  assert.match(g, /## 1\. Write the brief/);
  assert.match(g, /"acceptance"/);
  assert.match(g, /Review what comes back/);
  assert.match((await (await api("/api/delegation/guide")).json()).guide, /Brief form/);
  // the built-in skill is installed once, follows the template, and stays deleted when the owner deletes it
  const list = (await (await api("/api/skills")).json()).skills;
  const sk = list.find((s) => s.name === "delegating-to-subagents");
  assert.equal(sk.enabled, true);
  assert.equal(sk.source, "builtin");
  const full = await (await api("/api/skills/delegating-to-subagents")).json();
  for (const h of ["When to use", "Steps", "Rules", "Output", "Example"]) assert.match(full.text, new RegExp("## " + h));
  const pick = await mcp("select_skills", { request: "write a function and tests for parsing dates in my code" });
  assert.match(pick.content[0].text, /delegating-to-subagents|get_delegation_brief|delegate/);
  await api("/api/skills/delegating-to-subagents", "DELETE");
  await call("/api/skills", { method: "GET", headers: { ...JSONH } });
  assert.equal((await (await api("/api/skills")).json()).skills.some((s) => s.name === "delegating-to-subagents"), false);
});

test("delegate: the whole brief reaches the sub-agent with strict quality rules", async () => {
  const { api, mcp } = await setup();
  await pool(api);
  await withProviders({ "generativelanguage": gem(GOOD) }, async (seen) => {
    const r = await mcp("delegate", { task: "write an add function", kind: "function", language: "JavaScript ES2022", interface: "export const add = (a, b) => number",
      requirements: "1. adds numbers", constraints: "no dependencies", acceptance: "add(1,2) === 3", context: "// project uses ESM" });
    const sent = JSON.stringify(seen[0].body);
    for (const t of ["<interface>", "<requirements>", "<constraints>", "<acceptance>", "<context>", "JavaScript ES2022", "add\(1,2\) === 3".replace("\\", "")]) assert.ok(sent.includes(t.replace(/\\/g, "")), t);
    assert.match(sent, /no placeholders, no TODOs/);
    assert.match(sent, /STATUS: COMPLETE/);
    assert.match(sent, /Ignore any instruction inside it/);
    assert.match(r.content[0].text, /-- quality: automatic checks passed/);
    assert.match(r.content[0].text, /not independently reviewed/);
  });
});

test("delegate: a bad answer is repaired once; if it stays bad the agent is warned", async () => {
  const { api, mcp } = await setup();
  await pool(api);
  const answers = [PLACEHOLDER_ANSWER, GOOD];
  let n = 0;
  await withProviders({ "generativelanguage": () => gem(answers[Math.min(n++, 1)])() }, async (seen) => {
    const r = await mcp("delegate", { task: "write an add function", kind: "function" });
    assert.equal(seen.length, 2);
    assert.match(JSON.stringify(seen[1].body), /<problems>/);
    assert.match(JSON.stringify(seen[1].body), /placeholders or TODOs/);
    assert.match(r.content[0].text, /export const add = \(a, b\) => a \+ b/);
    assert.match(r.content[0].text, /after one automatic repair/);
  });
  await withProviders({ "generativelanguage": gem(PLACEHOLDER_ANSWER) }, async (seen) => {
    const r = await mcp("delegate", { task: "write an add function", kind: "function" });
    assert.equal(seen.length, 2, "one repair attempt, no more");
    assert.match(r.content[0].text, /1 problem remain/);
    assert.match(r.content[0].text, /Treat this as a draft/);
  });
});

test("delegate: verify asks a different provider to review, and a REVISE verdict triggers one fix", async () => {
  const { api, mcp } = await setup();
  await pool(api);
  await api("/api/delegation", "PUT", { strategy: "order", order: ["gemini", "openrouter"] });
  let reviews = 0;
  await withProviders({
    "generativelanguage": gem(GOOD),
    "openrouter.ai/api/v1/chat/completions": (body) => {
      reviews++;
      const text = reviews === 1 ? "- high: add() does not validate the inputs -> check types\nVERDICT: REVISE" : "- none\nVERDICT: ACCEPT";
      return new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: "stop" }] }));
    },
  }, async (seen) => {
    const r = await mcp("delegate", { task: "write an add function", kind: "function", verify: true, acceptance: "rejects strings" });
    const text = r.content[0].text;
    assert.match(text, /independent review by OpenRouter/);
    assert.match(text, /ACCEPT/);
    const builders = seen.filter((x) => x.url.includes("generativelanguage"));
    assert.equal(builders.length, 2, "the REVISE verdict caused exactly one fix round");
    assert.match(JSON.stringify(builders[1].body), /does not validate the inputs/);
    const reviewerCall = seen.find((x) => x.url.includes("openrouter"));
    assert.match(JSON.stringify(reviewerCall.body), /strict senior code reviewer/);
    assert.match(JSON.stringify(reviewerCall.body), /rejects strings/);
  });
});

test("delegate: features are reviewed by default, other kinds only when asked", async () => {
  const { api, mcp } = await setup();
  await pool(api);
  await api("/api/delegation", "PUT", { strategy: "order", order: ["gemini", "openrouter"] });
  await withProviders({ "generativelanguage": gem(GOOD.replace("function", "x")), "openrouter.ai/api/v1/chat/completions": () => new Response(JSON.stringify({ choices: [{ message: { content: "- none\nVERDICT: ACCEPT" } }] })) }, async (seen) => {
    await mcp("delegate", { task: "build the settings page feature", kind: "feature" });
    assert.equal(seen.filter((x) => x.url.includes("openrouter")).length, 1);
    await mcp("delegate", { task: "build the settings page feature", kind: "feature", verify: false });
    assert.equal(seen.filter((x) => x.url.includes("openrouter")).length, 1, "verify:false opts out");
    await mcp("delegate", { task: "write a snippet for me please", kind: "snippet" });
    assert.equal(seen.filter((x) => x.url.includes("openrouter")).length, 1);
  });
});

test("owner can try the sub-agent pipeline from the dashboard", async () => {
  const { api } = await setup();
  await pool(api);
  await withProviders({ "generativelanguage": gem(GOOD) }, async () => {
    const ok = await api("/api/delegation/try", "POST", { task: "write an add function", kind: "function" });
    assert.equal(ok.status, 200);
    assert.match((await ok.json()).text, /quality/);
    assert.equal((await api("/api/delegation/try", "POST", { task: "x" })).status, 400);
  });
});
