// Skills that ship with Memory Relay. Each is added once; if you delete or edit it, it is left alone.
import { getConfig, setConfig } from "./db.js";
import { SKILL_MD } from "./delegateguide.js";
import { addSkill, toSkillMd } from "./skills.js";
import { ADAPTED_SKILLS, SCRIPT_BANK } from "./anthropicSkills.js";
import { OFFICIAL_SHA, OFFICIAL_SKILLS, OFFICIAL_RESOURCES } from "./anthropicUpstream.generated.js";
import { now } from "./util.js";
import { OFFICIAL_REPO } from "./githubSkills.js";

const seen = new WeakSet();
export async function seedBuiltins(env) {
  if (seen.has(env.DB)) return;
  try {
    if (!(await getConfig(env, "seed_delegation_skill"))) {
      await addSkill(env, SKILL_MD, "builtin");
      await setConfig(env, "seed_delegation_skill", "1");
    }
    if (!OFFICIAL_SHA && !(await getConfig(env, "seed_anthropic_adaptations_v1"))) {
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
    await env.DB.prepare("INSERT OR IGNORE INTO skill_repos (id, owner, repo, root, ref, names, enabled) VALUES (?,?,?,?,?,?,0)")
      .bind(OFFICIAL_REPO.id, OFFICIAL_REPO.owner, OFFICIAL_REPO.repo, OFFICIAL_REPO.root, OFFICIAL_REPO.ref, OFFICIAL_REPO.names).run();
    if (OFFICIAL_SHA && !(await getConfig(env, "seed_official_anthropic_sha"))) {
      // Initial official import once; subsequent GitHub updates obey the repository sync switch.
      for (const sk of OFFICIAL_SKILLS) {
        const existing = await env.DB.prepare("SELECT name, description, source, body FROM skills WHERE name = ?").bind(sk.name).first();
        if (!existing) {
          await env.DB.prepare("INSERT INTO skills (name, description, body, enabled, core, source, created, updated) VALUES (?, ?, ?, 1, 0, 'builtin:anthropic-official', ?, ?)")
            .bind(sk.name, sk.description, sk.content, now(), now()).run();
        } else if (["builtin:anthropic-adapted", "builtin:anthropic-official"].includes(existing.source)) {
          // Preserve the earlier version for owner rollback.
          if (existing.body !== sk.content) {
            await env.DB.prepare("INSERT INTO skill_history (name, text, saved, by) VALUES (?, ?, ?, 'upstream-sync')")
              .bind(sk.name, toSkillMd(existing), now()).run();
            await env.DB.prepare("UPDATE skills SET description = ?, body = ?, source = 'builtin:anthropic-official', updated = ? WHERE name = ?")
              .bind(sk.description, sk.content, now(), sk.name).run();
          }
        }
      }
      for (const item of OFFICIAL_RESOURCES) {
        const row = await env.DB.prepare("SELECT source FROM skills WHERE name = ?").bind(item.skill).first();
        if (!row || !["builtin:anthropic-official", "builtin:anthropic-adapted", "owner:modified"].includes(row.source)) continue;
        await env.DB.prepare("INSERT INTO skill_resources (skill, path, kind, content, url) VALUES (?, ?, ?, ?, ?) ON CONFLICT(skill,path) DO UPDATE SET kind = excluded.kind, content = excluded.content, url = excluded.url")
          .bind(item.skill, item.path, item.kind, item.content, item.url).run();
      }
      await setConfig(env, "seed_official_anthropic_sha", OFFICIAL_SHA);
    }

  } catch (e) {
    console.error("seeding built-in skills failed:", e && e.message);
  }
}
