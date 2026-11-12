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
