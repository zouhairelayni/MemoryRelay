import test from "node:test";
import assert from "node:assert/strict";
import { createD1 } from "./helpers/d1.js";
import { ensureSchema, resetSchemaCache } from "../worker/db.js";
import { activity, pruneActivity } from "../worker/monitor.js";
import { listErrors } from "../worker/diagnostics.js";
import { listSkills } from "../worker/skills.js";
import { settings } from "../worker/api.js";

const value = (db, key) => db.prepare("SELECT value FROM counters WHERE key = ?").get(key)?.value;

test("counters follow every write instead of scanning on every read", async () => {
  resetSchemaCache();
  const { db, DB } = createD1();
  const env = { DB };
  await ensureSchema(env);
  assert.equal(value(db, "memories_total"), 0);
  assert.equal(value(db, "memories_rules"), 0);
  assert.equal(value(db, "services_active"), 1, "the default connection is active");

  // Insert: one memory row plus the total counter. Updating tags moves the rules counter.
  db.prepare("INSERT INTO memories (id,text,tags,created,updated) VALUES ('m1','one','', 't','t')").run();
  db.prepare("INSERT INTO memories (id,text,tags,created,updated) VALUES ('m2','two','build', 't','t')").run();
  assert.equal(value(db, "memories_total"), 2);
  assert.equal(value(db, "memories_rules"), 0);
  db.prepare("UPDATE memories SET tags = 'rules, build' WHERE id = 'm2'").run();
  assert.equal(value(db, "memories_rules"), 1);
  db.prepare("DELETE FROM memories WHERE id = 'm1'").run();
  assert.equal(value(db, "memories_total"), 1);
  assert.equal(value(db, "memories_rules"), 1);

  // Settings reads the counters: the numbers match the tables.
  const s = await settings(env);
  assert.equal(s.memories, 1);
  assert.equal(s.rules, 1);
  assert.equal(s.connections, 1);
  assert.equal(s.keys, 0);

  // Connections and key pools update their counters on toggle, not on read.
  db.prepare("UPDATE services SET revoked = 1").run();
  assert.equal(value(db, "services_active"), 0);
  db.prepare("UPDATE services SET revoked = 0").run();
  assert.equal(value(db, "services_active"), 1);
  db.prepare("INSERT INTO gemini_keys (id,label,key,created) VALUES ('k1','main','secret-key','t')").run();
  assert.equal(value(db, "api_keys_active"), 1);
  db.prepare("UPDATE gemini_keys SET enabled = 0 WHERE id = 'k1'").run();
  assert.equal(value(db, "api_keys_active"), 0);
  db.prepare("UPDATE gemini_keys SET enabled = 1 WHERE id = 'k1'").run();
  assert.equal(value(db, "api_keys_active"), 1);
  assert.equal((await settings(env)).keys, 1);

  // Running sub-agent jobs move with state changes.
  db.prepare("INSERT INTO delegations (service_id,ts,state) VALUES ('','1','running')").run();
  assert.equal(value(db, "delegations_running"), 1);
  db.prepare("UPDATE delegations SET state = 'completed'").run();
  assert.equal(value(db, "delegations_running"), 0);

  // Skill usage is counted when the event is recorded, and the list reads the counter.
  db.prepare("INSERT INTO skills (name,description,body,enabled,core,source,created,updated) VALUES ('demo','Use when testing.','Body',1,0,'paste','t','t')").run();
  assert.equal(value(db, "skills_total"), 1);
  await activity(env, { category: "skill", action: "selected", detail: "demo" });
  const skills = await listSkills(env);
  assert.equal(skills.find((x) => x.name === "demo").uses, 1);

  // Errors: trigger increments, default 7-day list reads the counter.
  await activity(env, { category: "api", action: "PUT /api/settings", ok: false, code: "HTTP_400" });
  assert.equal(value(db, "errors_total_7d"), 1);
  assert.equal((await listErrors(env, {})).total, 1);

  // Prune drops the old day and refreshes the counter from what is left. A manual
  // wrong value proves the refresh ran; a stale old day is not counted.
  const old = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
  db.prepare("INSERT INTO activity_daily (day,category,action,n,tin,tout,errors) VALUES (?,'api','old',9,0,0,9)").run(old);
  db.prepare("UPDATE counters SET value = 999 WHERE key = 'errors_total_7d'").run();
  await pruneActivity(env);
  assert.equal(value(db, "errors_total_7d"), 1, "only the retained error remains");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM activity_daily WHERE day = ?").get(old).n, 0);
});
