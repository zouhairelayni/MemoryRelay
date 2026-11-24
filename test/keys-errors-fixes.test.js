import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createD1 } from "./helpers/d1.js";
import worker from "../worker/index.js";
import { resetSchemaCache } from "../worker/db.js";
import { cleanApiKey, describeGeminiError, isTextGeminiModel, listGeminiModels } from "../worker/gemini.js";
import { openKey } from "../worker/secrets.js";

const JSONH = { "content-type": "application/json" };
const read = (p) => readFile(new URL("../" + p, import.meta.url), "utf8");

async function setup(extraEnv = {}) {
  resetSchemaCache();
  const { DB } = createD1();
  const env = { DB, ASSETS: { fetch: async () => new Response("app") }, ...extraEnv };
  const call = (path, init) => worker.fetch(new Request("http://localhost" + path, init), env, { waitUntil: (p) => p });
  const r = await call("/auth/setup", { method: "POST", headers: JSONH, body: JSON.stringify({ email: "o@x.io", password: "longenough12", setup_token: extraEnv.SETUP_TOKEN }) });
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  const api = (p, method = "GET", b) => call(p, { method, headers: { cookie, ...JSONH }, body: b ? JSON.stringify(b) : undefined });
  return { env, api };
}
const KEY1 = "AIzaSyA-1234567890abcdefghijklmnopqrstu", KEY2 = "AIzaSyB-1234567890abcdefghijklmnopqrstu";

test("cleanApiKey strips quotes and invisible characters and rejects embedded spaces", () => {
  assert.equal(cleanApiKey('  "' + KEY1 + '"\u200b\n').key, KEY1);
  assert.match(cleanApiKey("AIza part one part two xxxxxxxxxx").error, /spaces/);
  assert.match(cleanApiKey("x".repeat(401)).error, /too long/);
  assert.equal(cleanApiKey("").error, "paste a key");
});

test("Gemini errors show Google's reason (key redacted) instead of a bare HTTP code", () => {
  const msg = describeGeminiError(400, JSON.stringify({ error: { status: "FAILED_PRECONDITION", message: "User location is not supported for the API use." } }));
  assert.match(msg, /HTTP 400 FAILED_PRECONDITION: User location is not supported/);
  assert.match(msg, /region/);
  assert.match(describeGeminiError(400, JSON.stringify({ error: { message: "API key expired. Please renew the API key." } })), /Edit key/);
  assert.ok(!describeGeminiError(400, JSON.stringify({ error: { message: "bad " + KEY1 + KEY2 } })).includes("AIzaSyA"));
});

test("only text-generation Gemini models are listed", () => {
  const m = (name, methods = ["generateContent"]) => ({ name: "models/" + name, supportedGenerationMethods: methods });
  assert.ok(isTextGeminiModel(m("gemini-2.5-flash")));
  assert.ok(isTextGeminiModel(m("gemma-3-27b-it")));
  for (const bad of ["text-embedding-004", "gemini-2.5-flash-image", "gemini-2.5-flash-preview-tts", "imagen-4", "veo-3", "gemini-live-2.5-flash", "aqa"]) assert.ok(!isTextGeminiModel(m(bad)), bad);
  assert.ok(!isTextGeminiModel(m("gemini-2.5-pro", ["embedContent"])));
});

test("listGeminiModels follows pages and reports Google's real error", async () => {
  const real = globalThis.fetch; const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (!String(url).includes("generativelanguage")) return real(url);
    if (urls.length === 1) return new Response(JSON.stringify({ models: [{ name: "models/gemini-a", supportedGenerationMethods: ["generateContent"] }], nextPageToken: "p2" }));
    if (urls.length === 2) return new Response(JSON.stringify({ models: [{ name: "models/gemini-b", supportedGenerationMethods: ["generateContent"] }, { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] }] }));
    return new Response(JSON.stringify({ error: { status: "INVALID_ARGUMENT", message: "API key not valid." } }), { status: 400 });
  };
  try {
    assert.deepEqual((await listGeminiModels(KEY1)).models, ["gemini-a", "gemini-b"]);
    assert.match((await listGeminiModels(KEY1)).error, /HTTP 400 INVALID_ARGUMENT: API key not valid/);
  } finally { globalThis.fetch = real; }
});

test("edit_key renames, replaces (re-enabling and clearing cooldowns), and refuses duplicates - Gemini", async () => {
  const { env, api } = await setup();
  await api("/api/gemini", "POST", { op: "add_key", label: "one", key: KEY1 });
  let st = await (await api("/api/gemini", "POST", { op: "add_key", label: "two", key: KEY2 })).json();
  const one = st.keys.find((k) => k.label === "one"), two = st.keys.find((k) => k.label === "two");
  await env.DB.prepare("UPDATE gemini_keys SET enabled = 0 WHERE id = ?").bind(one.id).run();
  await env.DB.prepare("INSERT INTO gemini_cooldowns (key_id, model, until) VALUES (?, 'm', ?)").bind(one.id, Date.now() + 1e6).run();
  const NEW = "AIzaSyC-1234567890abcdefghijklmnopqrstu";
  st = await (await api("/api/gemini", "POST", { op: "edit_key", id: one.id, label: "renamed", key: ' "' + NEW + '" ' })).json();
  const edited = st.keys.find((k) => k.id === one.id);
  assert.equal(edited.label, "renamed"); assert.equal(edited.enabled, true); assert.equal(edited.tail, NEW.slice(-4)); assert.deepEqual(edited.cooling, []);
  assert.equal((await env.DB.prepare("SELECT key FROM gemini_keys WHERE id = ?").bind(one.id).first()).key, NEW);
  const dup = await api("/api/gemini", "POST", { op: "edit_key", id: two.id, key: NEW });
  assert.equal(dup.status, 400); assert.match((await dup.json()).error, /already saved/);
  assert.equal((await api("/api/gemini", "POST", { op: "edit_key", id: two.id })).status, 400);
  assert.equal((await api("/api/gemini", "POST", { op: "edit_key", id: "nope", label: "x" })).status, 400);
  const onlyLabel = await (await api("/api/gemini", "POST", { op: "edit_key", id: two.id, label: "second" })).json();
  assert.equal(onlyLabel.keys.find((k) => k.id === two.id).label, "second");
});

test("edit_key works for OpenRouter/NVIDIA/OpenAI keys and validates the key shape; sealed keys stay sealed", async () => {
  const { env, api } = await setup({ KEY_SECRET: "a-long-random-secret-for-tests-0123456789" });
  const OR1 = "sk-or-v1-" + "a".repeat(40), OR2 = "sk-or-v1-" + "b".repeat(40);
  let st = await (await api("/api/openrouter", "POST", { op: "add_key", label: "or", key: OR1 })).json();
  const id = st.keys[0].id;
  assert.equal((await api("/api/openrouter", "POST", { op: "edit_key", id, key: "sk-wrong-" + "c".repeat(30) })).status, 400);
  st = await (await api("/api/openrouter", "POST", { op: "edit_key", id, key: OR2, label: "or2" })).json();
  assert.equal(st.keys[0].label, "or2"); assert.equal(st.keys[0].tail, OR2.slice(-4));
  const stored = (await env.DB.prepare("SELECT key FROM openrouter_keys WHERE id = ?").bind(id).first()).key;
  assert.ok(stored.startsWith("enc:v1:")); assert.equal(await openKey(env, stored), OR2);
});

test("model browsing opens sealed keys for OpenRouter-style providers (no ciphertext sent upstream)", async () => {
  const { api } = await setup({ KEY_SECRET: "a-long-random-secret-for-tests-0123456789" });
  const NV = "nvapi-" + "d".repeat(40);
  await api("/api/nvidia", "POST", { op: "add_key", label: "nv", key: NV });
  const real = globalThis.fetch; let auth = "";
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes("integrate.api.nvidia.com")) return real(url, init);
    auth = init.headers.authorization; return new Response(JSON.stringify({ data: [{ id: "meta/llama-3.1-70b-instruct" }] }));
  };
  try {
    const r = await (await api("/api/nvidia/models")).json();
    assert.equal(auth, "Bearer " + NV); assert.equal(r.models[0].id, "meta/llama-3.1-70b-instruct");
  } finally { globalThis.fetch = real; }
});

test("Errors screen scrolls (own pane) and Back to overview leaves the Errors layer", async () => {
  const shell = await read("src/shell/AppShell.jsx");
  assert.match(shell, /<section className="pane errors-pane"[^>]*data-pane="errors"[^>]*><ErrorsScreen active \/><\/section>/);
  assert.match(shell, /if \(id === tabId && route === id\)/, "re-tapping the current tab only scrolls when that tab is actually showing");
  assert.match(shell, /\[go, tabId, route\]/);
  assert.match(await read("src/modules/home/ErrorsScreen.jsx"), /icon="back" onClick=\{\(\) => go\("home"\)\}/);
});

test("Edit key control is wired for every provider and Gemini errors render in the error tone", async () => {
  assert.match(await read("src/modules/keys/KeyRow.jsx"), /icon: "pencil"/);
  assert.match(await read("src/modules/keys/GeminiPanel.jsx"), /op: "edit_key"/);
  assert.match(await read("src/modules/keys/CompatPanel.jsx"), /op: "edit_key"/);
  assert.match(await read("src/modules/keys/GeminiPanel.jsx"), /tone=\{g\.messageTone/);
});
