import test from "node:test";
import assert from "node:assert/strict";
import { createD1 } from "./helpers/d1.js";
import { resetSchemaCache } from "../worker/db.js";
import { ensureSchema } from "../worker/db.js";
import { seedBuiltins } from "../worker/builtins.js";
import { selectSkills, formatForAgent } from "../worker/skills.js";
import { callTool } from "../worker/mcp.js";
import { ADAPTED_SKILLS, SCRIPT_BANK } from "../worker/anthropicSkills.js";

const setup = async () => {
  resetSchemaCache();
  const { db, DB } = createD1();
  const env = { DB };
  await ensureSchema(env);
  await seedBuiltins(env);
  return { db, env };
};

test("11 adapted skills are installed once without modifying existing ones", async () => {
  const { db, env } = await setup();
  assert.equal(ADAPTED_SKILLS.length, 11);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM skills WHERE source = 'builtin:anthropic-adapted'").get().n, 11);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM skill_scripts").get().n, SCRIPT_BANK.length);
  await seedBuiltins(env);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM skills").get().n, 12);
});

test("selected webapp skill includes its script; unrelated skills do not", async () => {
  const { env } = await setup();
  const match = await selectSkills(env, { request: "Use Playwright to test my local browser webapp and capture a screenshot" }, { useGemini: false });
  assert.ok(match.skills.some(x => x.name === "webapp-testing"));
  assert.match(formatForAgent(match), /===== PYTHON SCRIPT BANK: webapp-smoke =====/);
  const unrelated = await selectSkills(env, { request: "plan my week's meals" }, { useGemini: false });
  assert.doesNotMatch(formatForAgent(unrelated), /webapp-smoke/);
});

test("script bank tool returns source only and rejects unknown names", async () => {
  const { env } = await setup();
  const s = await callTool(env, "get_skill_script", { name: "webapp-smoke" });
  assert.match(s.code, /sync_playwright/);
  await assert.rejects(callTool(env, "get_skill_script", { name: "secret" }), /script not found/);
});
