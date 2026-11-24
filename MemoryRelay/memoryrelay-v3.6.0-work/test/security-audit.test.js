import test from "node:test";
import assert from "node:assert/strict";
import { createD1 } from "./helpers/d1.js";
import worker from "../worker/index.js";
import { ensureSchema, resetSchemaCache } from "../worker/db.js";
import { locked, recordFail, pruneLoginFails } from "../worker/auth.js";
import { gemini } from "../worker/gemini.js";

test("a login lock that has expired starts counting from zero (one typo no longer re-locks for 15 minutes)", async () => {
  resetSchemaCache();
  const { db, DB } = createD1();
  const env = { DB };
  await ensureSchema(env);
  const keys = ["email:a@b.io", "ip:1.2.3.4"];
  for (let i = 0; i < 5; i++) await recordFail(env, keys);
  assert.equal(await locked(env, keys), true);
  db.prepare("UPDATE login_fails SET locked_until = ?").run(Date.now() - 1000); // the wait is over
  assert.equal(await locked(env, keys), false);
  await recordFail(env, keys); // one typo
  assert.equal(await locked(env, keys), false);
  assert.equal(db.prepare("SELECT fails FROM login_fails WHERE key = ?").get(keys[0]).fails, 1);
  for (let i = 0; i < 4; i++) await recordFail(env, keys);
  assert.equal(await locked(env, keys), true, "five fresh failures still lock");
  db.prepare("UPDATE login_fails SET locked_until = ?").run(Date.now() - 1000);
  await pruneLoginFails(env);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM login_fails").get().n, 0);
});

test("memory import refuses an oversized body instead of reading it all", async () => {
  resetSchemaCache();
  const { DB } = createD1();
  const env = { DB, ASSETS: { fetch: async () => new Response("app") } };
  const ctx = { waitUntil: (p) => p };
  const call = (path, init) => worker.fetch(new Request("http://localhost" + path, init), env, ctx);
  const r = await call("/auth/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "o@x.io", password: "longenough12" }) });
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const big = JSON.stringify({ memories: [{ text: "x".repeat(13 * 1024 * 1024) }] });
  const res = await call("/api/import", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: big });
  assert.equal(res.status, 413);
});

test("a Gemini 403 about one model does not disable the key; an invalid key still does", async () => {
  resetSchemaCache();
  const { DB } = createD1();
  const env = { DB };
  await ensureSchema(env);
  await DB.prepare("DELETE FROM gemini_keys").run();
  await DB.prepare("INSERT INTO gemini_keys (id,label,key,created) VALUES ('k1','good','AIza-test-1','t')").run();
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('{"error":{"message":"Model is not available in your region"}}', { status: 403 });
    await gemini(env, "hi");
    assert.equal((await DB.prepare("SELECT enabled FROM gemini_keys WHERE id='k1'").first()).enabled, 1);
    assert.ok((await DB.prepare("SELECT COUNT(*) n FROM gemini_cooldowns").first()).n >= 1, "key+model rests instead");
    await DB.prepare("DELETE FROM gemini_cooldowns").run();
    globalThis.fetch = async () => new Response('{"error":{"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}', { status: 400 });
    const r = await gemini(env, "hi");
    assert.match(r.error, /key rejected, disabled/);
    assert.equal((await DB.prepare("SELECT enabled FROM gemini_keys WHERE id='k1'").first()).enabled, 0);
  } finally { globalThis.fetch = real; }
});

test("a deployed Worker refuses to create the owner without SETUP_TOKEN; localhost and a correct token still work", async () => {
  resetSchemaCache();
  const { DB } = createD1();
  const env = { DB, ASSETS: { fetch: async () => new Response("app") } };
  const ctx = { waitUntil: (p) => p };
  const setup = (host, extra = {}, e = env) => worker.fetch(new Request(`https://${host}/auth/setup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "o@x.io", password: "longenough12", ...extra }) }), e, ctx);
  const status = async (host, e = env) => (await (await worker.fetch(new Request(`https://${host}/auth/status`), e, ctx)).json());
  assert.equal((await status("relay.example.workers.dev")).setup_locked, true);
  const locked = await setup("relay.example.workers.dev");
  assert.equal(locked.status, 403);
  assert.match((await locked.json()).error, /SETUP_TOKEN/);
  const withToken = { ...env, SETUP_TOKEN: "s3cret-token-value" };
  assert.equal((await status("relay.example.workers.dev", withToken)).setup_locked, false);
  assert.equal((await setup("relay.example.workers.dev", { setup_token: "wrong" }, withToken)).status, 403);
  assert.equal((await setup("relay.example.workers.dev", { setup_token: "s3cret-token-value" }, withToken)).status, 200);
  resetSchemaCache();
  const second = createD1();
  const local = { DB: second.DB, ASSETS: env.ASSETS };
  assert.equal((await setup("localhost", {}, local)).status, 200, "local development stays open");
});

test("with KEY_SECRET, provider keys are stored encrypted, still work, and show only their last 4 characters", async () => {
  const { sealKey, openKey, isSealed, keyTail, sealAllKeys } = await import("../worker/secrets.js");
  const { geminiOp, geminiState } = await import("../worker/gemini.js");
  resetSchemaCache();
  const { db, DB } = createD1();
  const env = { DB, KEY_SECRET: "a-long-random-secret-for-tests-0123456789" };
  await ensureSchema(env);
  const plain = "AIzaSyD-test-key-1234";
  const sealed = await sealKey(env, plain);
  assert.ok(isSealed(sealed));
  assert.ok(!sealed.includes(plain) && !sealed.includes("test-key"));
  assert.equal(keyTail(sealed), "1234");
  assert.equal(await openKey(env, sealed), plain);
  assert.notEqual(await sealKey(env, plain), sealed, "a fresh random IV every time");
  assert.equal(await openKey({ DB, KEY_SECRET: "the wrong secret" }, sealed), null);
  assert.equal(await openKey({ DB }, sealed), null, "no secret: cannot be read");

  // adding through the dashboard path stores ciphertext; the same key twice is saved once
  const add = (key) => geminiOp(env, new Request("http://localhost/api/gemini", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "add_key", label: "g", key }) }));
  await add(plain); await add(plain);
  const rows = db.prepare("SELECT key FROM gemini_keys").all();
  assert.equal(rows.length, 1);
  assert.ok(isSealed(rows[0].key) && !rows[0].key.includes("test-key"));
  assert.equal((await geminiState(env)).keys[0].tail, "1234");

  // a key saved before the secret existed is encrypted by the one-time migration
  db.prepare("INSERT INTO openrouter_keys (id,label,key,created) VALUES ('o1','o','sk-or-v1-plainplain9999','t')").run();
  assert.equal(await sealAllKeys(env), 1);
  const o = db.prepare("SELECT key FROM openrouter_keys WHERE id='o1'").get().key;
  assert.ok(isSealed(o));
  assert.equal(await openKey(env, o), "sk-or-v1-plainplain9999");
  assert.equal(await sealAllKeys(env), 0, "nothing left to convert");

  // the call path uses the decrypted key; without the secret it explains why instead of failing mysteriously
  await DB.prepare("INSERT INTO gemini_models (name,enabled,pos) VALUES ('gemini-x',1,0)").run();
  const real = globalThis.fetch;
  try {
    let sentKey = "";
    globalThis.fetch = async (url, init) => { sentKey = init.headers["x-goog-api-key"]; return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "hi" }] } }] }), { status: 200 }); };
    assert.equal((await gemini(env, "hello")).text, "hi");
    assert.equal(sentKey, plain);
    const locked = await gemini({ DB }, "hello");
    assert.match(locked.error, /KEY_SECRET is missing or wrong/);
  } finally { globalThis.fetch = real; }
});
