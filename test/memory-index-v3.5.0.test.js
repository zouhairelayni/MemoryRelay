import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createD1 } from "./helpers/d1.js";
import { resetSchemaCache } from "../worker/db.js";
import worker from "../worker/index.js";

const BASE = "http://localhost";
async function fixture({ legacy = false } = {}) {
  resetSchemaCache();
  const { db, DB } = createD1();
  if (legacy) {
    db.exec("CREATE TABLE memories (id TEXT PRIMARY KEY, text TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', created TEXT NOT NULL, updated TEXT NOT NULL, history TEXT NOT NULL DEFAULT '[]')");
    db.prepare("INSERT INTO memories (id,text,tags,source,created,updated) VALUES (?,?,?,?,?,?)")
      .run("legacy-1", "**Older build**\n- *Result:* preserved", "build-01", "import", "2026-01-01 00:00", "2026-01-01 00:00");
  }
  const env = { DB, ASSETS: { fetch: async () => new Response("index") } };
  const call = (path, init) => worker.fetch(new Request(BASE + path, init), env, { waitUntil: () => {} });
  const init = await call("/auth/setup", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "tester@local.test", password: "long-password-123" }) });
  assert.equal(init.status, 200);
  const cookie = init.headers.get("set-cookie").split(";")[0];
  const api = (path, method = "GET", value) => call(path, { method, headers: { cookie, "content-type": "application/json" }, body: value === undefined ? undefined : JSON.stringify(value) });
  const svc = (await (await api("/api/services")).json()).services[0];
  const rpc = async (method, params = {}) => (await (await call(svc.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;
  const tool = async (name, arguments_ = {}) => {
    const result = await rpc("tools/call", { name, arguments: arguments_ });
    assert.equal(result.isError, undefined, result.content?.[0]?.text);
    return result.content[0].text;
  };
  return { db, api, rpc, tool, call };
}

test("schema migration preserves legacy Markdown and context tags with no invented version", async () => {
  const { db, tool, api } = await fixture({ legacy: true });
  const columns = db.prepare("SELECT name FROM pragma_table_info('memories')").all().map((r) => r.name);
  assert.ok(columns.includes("description") && columns.includes("metadata"));
  const entry = JSON.parse(await tool("get_memory", { memory_id: "legacy-1" }));
  assert.equal(entry.text, "**Older build**\n- *Result:* preserved");
  assert.equal(entry.description, "Older build");
  assert.equal(entry.tags, "build-01");
  assert.equal(entry.metadata.version, "");
  assert.deepEqual(entry.metadata.stack, []);
  assert.equal((await (await api("/api/memories/legacy-1")).json()).text, entry.text);
});

test("MCP search traverses every entry beyond first 20 and first 500 without full content", async () => {
  const { db, tool } = await fixture();
  const insert = db.prepare("INSERT INTO memories (id, text, tags, source, created, updated) VALUES (?, ?, '', 'test', ?, ?)");
  for (let i = 0; i < 1125; i++) {
    const date = `2026-11-23 ${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}`;
    insert.run(`id-${i}`, `**Release ${i}**\n- *Verified:* value ${i}\n\n\`\`\`bash\necho sample-${i}\n\`\`\``, date, date);
  }
  let offset = 0; const seen = new Set();
  for (let p = 0; p < 12; p++) {
    const page = JSON.parse(await tool("list_memories", { limit: 100, offset }));
    assert.equal(page.total, 1125);
    for (const item of page.results) {
      assert.ok(!("text" in item), "discovery should not return full Markdown");
      assert.ok(item.description.length > 0);
      seen.add(item.id);
    }
    if (page.next_offset === null) break;
    offset = page.next_offset;
  }
  assert.equal(seen.size, 1125, "last entries must be reachable");
  assert.ok(seen.has("id-0") && seen.has("id-1124"));
  const full = JSON.parse(await tool("get_memory", { memory_id: "id-0" }));
  assert.ok(full.text.includes("echo sample-0"));
  const results = JSON.parse(await tool("search", { query: "sample-3", limit: 15 }));
  assert.ok(results.total > 0);
  let found = results.results.some((r) => r.id === "id-3");
  let next = results.next_offset;
  while (!found && next !== null) {
    const page = JSON.parse(await tool("search", { query: "sample-3", limit: 100, offset: next }));
    found = page.results.some((r) => r.id === "id-3");
    next = page.next_offset;
  }
  assert.ok(found);
});

test("memory descriptions, typed labels, legacy tags and Markdown round-trip through MCP and owner API", async () => {
  const { db, tool, rpc, api, call } = await fixture();
  const body = "**MemoryRelay v3.5.0 search**\n- *Goal:* find memories\n\n```bash\nnpm test\n```";
  const added = await tool("remember", { text: body, tags: "audit,search", description: "MemoryRelay indexed discovery and full read by ID", metadata: {
    app: "MemoryRelay", platforms: ["PWA", "Web"], feature: "Memory search", version: "v3.5.0", languages: ["JavaScript"], stack: ["Cloudflare D1", "React"],
  } });
  assert.match(added, /^saved /);
  const id = added.slice(6);
  assert.equal(db.prepare("SELECT tags FROM memories WHERE id = ?").get(id).tags, "audit,search");
  const x = JSON.parse(await tool("search", { query: "discovery", app: "MemoryRelay", version: "v3.5.0", platforms: "pwa", languages: "javascript", stack: "react" }));
  assert.equal(x.total, 1);
  assert.equal(x.results[0].description, "MemoryRelay indexed discovery and full read by ID");
  assert.equal(x.results[0].metadata.feature, "Memory search");
  assert.equal("text" in x.results[0], false);
  assert.equal(JSON.parse(await tool("get_memory", { memory_id: id })).text, body);
  assert.equal((await (await api("/api/memories?q=discovery")).json()).items[0].description, x.results[0].description);
  assert.equal((await (await api("/api/memories?app=MemoryRelay&platforms=web")).json()).total, 1);
  assert.match(await tool("update_memory", { memory_id: id, description: "A revised summary", metadata: { version: "v3.5.1", stack: [] } }), /updated/);
  const changed = JSON.parse(await tool("get_memory", { memory_id: id }));
  assert.equal(changed.description, "A revised summary");
  assert.equal(changed.metadata.version, "v3.5.1");
  assert.equal(changed.metadata.app, "MemoryRelay");
  assert.deepEqual(changed.metadata.stack, []);
  assert.deepEqual(changed.metadata.languages, ["JavaScript"]);
  assert.equal(changed.tags, "audit,search");
  assert.equal(changed.text, body);
  const denied = await call("/api/memories/" + id);
  assert.equal(denied.status, 401);
  const listed = (await rpc("tools/list")).tools;
  for (const n of ["get_memory_settings", "remember", "search", "list_memories", "get_memory", "update_memory"]) assert.ok(listed.find((t) => t.name === n), n);
  const remember = listed.find((t) => t.name === "remember");
  assert.match(remember.description, /Markdown/);
  assert.match(remember.description, /copyable|inline commands/);
  assert.ok(remember.inputSchema.properties.description);
  assert.ok(remember.inputSchema.properties.metadata.properties.stack);
  assert.match(listed.find((t) => t.name === "search").description, /ENTIRE memory library/);
  assert.match(listed.find((t) => t.name === "get_memory").description, /code snippets/);
});

test("metadata validation, protected rules, and replace-import error checks preserve data", async () => {
  const { tool, rpc, api, db } = await fixture();
  const malformed = await rpc("tools/call", { name: "remember", arguments: { text: "**Bad**", metadata: { unknown: "x" } } });
  assert.equal(malformed.isError, true);
  assert.match(await tool("remember", { text: "**Bad**", description: "x".repeat(281) }), /not saved/);
  const rule = await (await api("/api/memories", "POST", { rule: true, text: "**Owner rule**", description: "Protected policy", metadata: { feature: "security" } })).json();
  assert.equal(rule.ok, true);
  assert.match(await tool("update_memory", { memory_id: rule.id, description: "Bypass?" }), /protected/);
  assert.equal(db.prepare("SELECT description FROM memories WHERE id = ?").get(rule.id).description, "Protected policy");
  const normal = await (await api("/api/memories", "POST", { text: "**Keep**", metadata: { version: "BUILD 07" } })).json();
  assert.ok(normal.id);
  const response = await api("/api/import?mode=replace", "POST", [{ text: "**Other**", metadata: { languages: ["x".repeat(60)] } }]);
  assert.equal(response.status, 400);
  const original = db.prepare("SELECT text FROM memories WHERE id=?").get(normal.id);
  assert.equal(original.text, "**Keep**");
  const ok = await (await api("/api/export")).json();
  assert.ok(ok.some((row) => row.id === normal.id && JSON.parse(row.metadata).version === "BUILD 07"));
});

test("owner UI contains editable descriptions, typed badges and full-library pagination", () => {
  const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  assert.match(read("src/modules/memory/MemoryEditor.jsx"), /Short description/);
  assert.match(read("src/modules/memory/MemoryEditor.jsx"), /Build \/ release/);
  assert.match(read("src/modules/memory/MemoryCard.jsx"), /<MemoryLabels/);
  assert.match(read("src/modules/memory/MemoryScreen.jsx"), /loadMore/);
  assert.match(read("src/styles/redesign.css"), /\.memory-label-amber/);
});

test("separate build/release metadata prevents housekeeping from merging different versions", async () => {
  const { api, db } = await fixture();
  const old = await (await api("/api/memories", "POST", { text: "**AI Router BUILD 08**", metadata: { app: "RIVNA", version: "BUILD 08" } })).json();
  const current = await (await api("/api/memories", "POST", { text: "**AI Router BUILD 09**", metadata: { app: "RIVNA", version: "BUILD 09" } })).json();
  assert.ok(old.id && current.id);
  const resp = await (await api("/api/housekeep", "POST", { apply: true, groups: [{ keep: current.id, drop: [old.id], merged_text: "" }] })).json();
  assert.equal(resp.removed, 0, JSON.stringify(resp));
  assert.ok(db.prepare("SELECT id FROM memories WHERE id = ?").get(old.id));
  assert.ok(db.prepare("SELECT id FROM memories WHERE id = ?").get(current.id));
});

test("export and import roundtrip keep searchable descriptions and typed labels", async () => {
  const { api } = await fixture();
  const first = await (await api("/api/memories", "POST", {
    text: "**Transport note**\n- *Command:* npm test", description: "Build task verified in beta",
    tags: "build,beta", metadata: { app: "RIVNA", version: "BUILD 10", platforms: ["PWA"], languages: ["TypeScript"], stack: ["Firebase"] },
  })).json();
  assert.ok(first.id);
  const backup = await (await api("/api/export")).json();
  const imported = await (await api("/api/import?mode=replace", "POST", backup)).json();
  assert.equal(imported.imported, 1);
  const list = await (await api("/api/memories?version=BUILD%2010&app=RIVNA&platforms=pwa")).json();
  assert.equal(list.total, 1);
  assert.equal(list.items[0].description, "Build task verified in beta");
  assert.deepEqual(list.items[0].metadata.stack, ["Firebase"]);
  assert.equal(list.items[0].tags, "build,beta");
});
