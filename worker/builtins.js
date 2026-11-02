// Skills that ship with Memory Relay. Each is added once; if you delete or edit it, it is left alone.
import { getConfig, setConfig } from "./db.js";
import { SKILL_MD } from "./delegateguide.js";
import { addSkill } from "./skills.js";
import { ADAPTED_SKILLS, SCRIPT_BANK } from "./anthropicSkills.js";

const seen = new WeakSet();
export async function seedBuiltins(env) {
  if (seen.has(env.DB)) return;
  seen.add(env.DB);
  try {
    if (!(await getConfig(env, "seed_delegation_skill"))) {
      await addSkill(env, SKILL_MD, "builtin");
      await setConfig(env, "seed_delegation_skill", "1");
    }
    if (!(await getConfig(env, "seed_anthropic_adaptations_v1"))) {
      for (const text of ADAPTED_SKILLS) {
        const result = await addSkill(env, text, "builtin:anthropic-adapted");
        if (result.error && !result.error.includes("already exists")) throw new Error(result.error);
      }
      for (const script of SCRIPT_BANK) {
        await env.DB.prepare("INSERT OR IGNORE INTO skill_scripts (name, skill, description, code) VALUES (?, ?, ?, ?)")
          .bind(script.name, script.skill, script.description, script.code).run();
      }
      await setConfig(env, "seed_anthropic_adaptations_v1", "1");
    }
  } catch (e) {
    console.error("seeding built-in skills failed:", e && e.message);
  }
}
