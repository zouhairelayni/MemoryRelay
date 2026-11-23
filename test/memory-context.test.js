import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createD1 } from "./helpers/d1.js";
import { resetSchemaCache } from "../worker/db.js";
import { estimateMemoryTokens, DEFAULT_MEMORY_TOKENS } from "../shared/memoryBudget.js";
import worker from "../worker/index.js";

const base = "http://localhost";
async function setup() {
  resetSchemaCache();
  const { db, DB } = createD1();
  const env = { DB, ASSETS: { fetch: async () => new Response("app") } };
  const ctx = { waitUntil: () => {} };
  const call = (path, init) => worker.fetch(new Request(base + path, init), env, ctx);
  const res = await call("/auth/setup", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "owner@example.com", password: "enoughpassword123" }) });
  assert.equal(res.status, 200);
  const cookie = res.headers.get("set-cookie").split(";")[0];
  const api = (path, method = "GET", value) => call(path, { method,
    headers: { cookie, "content-type": "application/json" }, body: value === undefined ? undefined : JSON.stringify(value) });
  const svc = (await (await api("/api/services")).json()).services[0];
  const rpc = async (method, params = {}) => (await (await call(svc.url, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;
  const tool = async (name, args) => (await rpc("tools/call", { name, arguments: args })).content[0].text;
  return { db, env, api, call, rpc, tool, cookie };
}

test("settings default to 1000 estimated tokens; owner changes are immediately authoritative in MCP", async () => {
  const { api, rpc, tool } = await setup();
  assert.equal(DEFAULT_MEMORY_TOKENS, 1000);
  assert.equal((await (await api("/api/settings")).json()).memory_max_tokens, 1000);
  assert.equal((await (await api("/api/memory-settings")).json()).max_tokens, 1000);
  assert.equal(JSON.parse(await tool("get_memory_settings", {})).max_tokens, 1000);
  const descriptions = (await rpc("tools/list")).tools;
  assert.match(descriptions.find(t => t.name === "remember").description, /1000 estimated tokens/);
  assert.match((await rpc("initialize")).instructions, /1000 estimated tokens/);
  const long = "record " + "alpha ".repeat(200); // more than 500 characters, less than 1000 estimated tokens
  assert.ok(long.length > 500 && estimateMemoryTokens(long) < 1000);
  const saved = await tool("remember", { text: long });
  assert.match(saved, /^saved /);
  const recent = JSON.parse(await tool("recent", { n: 1 }));
  assert.match(recent.results[0].text, /^\*\*[^\n]+\*\*\n- \*Detail:\*/);
  assert.ok(recent.results[0].text.includes(long.trim()), "the MCP retrieval must not truncate the original text");

  assert.equal((await api("/api/memory-settings", "PUT", { max_tokens: 300 })).status, 200);
  const revised = (await rpc("tools/list")).tools.find(t => t.name === "remember");
  assert.match(revised.description, /300 estimated tokens/);
  assert.match(revised.inputSchema.properties.text.description, /300 estimated tokens/);
  assert.match((await rpc("initialize")).instructions, /300 estimated tokens/);
  assert.match(await tool("remember", { text: "bravo ".repeat(400) }), /not saved: over 300/);
  assert.equal((await (await api("/api/settings")).json()).memory_max_tokens, 300);
  assert.equal(JSON.parse(await tool("get_memory_settings", {})).max_tokens, 300);
  assert.ok(JSON.parse(await tool("recent", { n: 1 })).results[0].text.includes(long.trim()), "lowering limit does not mutilate existing memories");
});

test("memory limit cannot be changed by an unauthenticated user or via MCP", async () => {
  const { api, call, tool } = await setup();
  assert.equal((await call("/api/memory-settings")).status, 401);
  assert.equal((await call("/api/memory-settings", {method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({max_tokens:8000})})).status, 401);
  for (const value of [0, 1, 99, 8001, -1, 1.5, "8000", null]) {
    assert.equal((await api("/api/memory-settings", "PUT", { max_tokens:value })).status, 400, String(value));
  }
  assert.equal((await (await api("/api/memory-settings")).json()).max_tokens, 1000);
  assert.match(await tool("remember", { text: "simple" }), /saved/);
});

test("import never silently truncates an oversized memory or deletes existing memories on replacement", async () => {
  const { api } = await setup();
  assert.equal((await api("/api/memories", "POST", { text: "Keep this fact" })).status, 200);
  assert.equal((await api("/api/memory-settings", "PUT", { max_tokens: 100 })).status, 200);
  const no = await api("/api/import?mode=replace", "POST", [{ text: "over ".repeat(500) }]);
  assert.equal(no.status, 400);
  assert.match((await no.json()).error, /oversized memory/);
  assert.deepEqual((await (await api("/api/memories")).json()).items.map(m => m.text), ["Keep this fact"]);
});

test("housekeeping will never remove duplicates if merged text exceeds configured context length", async () => {
  const { api } = await setup();
  const a = await (await api("/api/memories", "POST", { text: "First independent thought" })).json();
  const b = await (await api("/api/memories", "POST", { text: "Second unrelated thought" })).json();
  await api("/api/memory-settings", "PUT", { max_tokens: 100 });
  const response = await api("/api/housekeep", "POST", { apply: true, groups: [{ keep: a.id, drop: [b.id], merged_text: "long ".repeat(300) }] });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /No memories were changed/);
  assert.equal((await (await api("/api/memories")).json()).count, 2);
});

test("ordinary owner API bodies are bounded and bad JSON is rejected", async () => {
  const { api, call, cookie } = await setup();
  assert.equal((await api("/api/memories", "POST", { text: "OK" })).status, 200);
  const veryLarge = JSON.stringify({ text: "x".repeat(300000) });
  const tooBig = await call("/api/memories", { method: "POST", headers: {cookie,"content-type":"application/json"},body:veryLarge });
  assert.equal(tooBig.status, 413);
  const invalid = await call("/api/memories", { method: "POST", headers: {cookie,"content-type":"application/json"},body:"{oops" });
  assert.equal(invalid.status, 400);
  assert.equal((await (await api("/api/memories")).json()).count, 1);
});

test("UI has installed-PWA-only header refresh, compact scroller and in-app chart dropdown", () => {
  const read = name => readFileSync(new URL("../" + name, import.meta.url), "utf8");
  assert.match(read("src/shell/PwaRefresh.jsx"), /display-mode: standalone/);
  assert.match(read("src/shell/PwaRefresh.jsx"), /navigator.standalone/);
  assert.match(read("src/shell/PwaRefresh.jsx"), /window.location.reload/);
  assert.match(read("src/shell/TopBar.jsx"), /<PwaRefresh \/>/);
  assert.match(read("src/modules/skills/GithubSources.jsx"), /repo-list-scroll/);
  assert.match(read("src/styles/screens.css"), /--repo-preview-row:125px;max-height:calc\(var\(--repo-preview-row\)\*3\.5\)/);
  assert.match(read("src/modules/home/MonitorPanel.jsx"), /<MetricDropdown/);
  assert.doesNotMatch(read("src/modules/home/MetricDropdown.jsx"), /showPicker\(\)/);
  assert.match(read("src/settings/SettingsSheet.jsx"), /<MemoryContext \/>/);
  assert.match(read("package.json"), /"version": "3.5.0"/);
});
