// Skills that ship with Memory Relay. Each is added once; if you delete or edit it, it is left alone.
import { getConfig, setConfig } from "./db.js";
import { SKILL_MD } from "./delegateguide.js";
import { addSkill } from "./skills.js";

const seen = new WeakSet();
export async function seedBuiltins(env) {
  if (seen.has(env.DB)) return;
  seen.add(env.DB);
  try {
    if (await getConfig(env, "seed_delegation_skill")) return;
    await addSkill(env, SKILL_MD, "builtin"); // an "already exists" answer is fine too
    await setConfig(env, "seed_delegation_skill", "1");
  } catch (e) {
    console.error("seeding built-in skills failed:", e && e.message);
  }
}
