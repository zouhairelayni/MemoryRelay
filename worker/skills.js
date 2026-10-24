// Skill Genie: skills live in D1. An agent sends only its request (and optionally the files it
// will touch). The Genie picks the few skills that matter, using Gemini when it can and keywords
// when it cannot, and returns just those SKILL.md texts. Agents never browse the library themselves.
import { complete } from "./llm.js";
import { getConfig, setConfig } from "./db.js";
import { now } from "./util.js";

export const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
export const MAX_TOKENS = 5000;   // hard limit per skill, enforced for owner and agent uploads
export const MAX_SKILLS = 200;    // library size cap
// Rough but conservative token count: the larger of chars/4 and words*1.3 (English text).
export function estimateTokens(text) {
  const t = String(text || "");
  const words = (t.match(/\S+/g) || []).length;
  return Math.ceil(Math.max(t.length / 4, words * 1.3));
}
export const SKILL_TEMPLATE = `---
name: lowercase-with-dashes
description: Use when <the exact situations that should trigger this skill>. <one sentence on what it gives the agent>.
---
# <Short title>

## When to use
- <trigger 1>
- <trigger 2>

## Steps
1. <first concrete action>
2. <next action>

## Rules
- <hard constraint, e.g. "never edit lockfiles">

## Output
- <what the agent should return and in what shape>

## Example
<one short, realistic example input and expected output>
`;
const CANDIDATES = 40;      // how many keyword-matched skills Gemini gets to choose from
const DEFAULT_MAX = 3;

// Same stop words and synonyms as the desktop genie, so picks match between the two.
const STOP = new Set("a an and are as at be by for from how i in into is it my of on or our so that the this to us we what when with you your".split(" "));
const SYN = { css: "style styles tailwind layout", ui: "design interface component", video: "mp4 render remotion animation", animation: "motion rive lottie", test: "tests testing vitest playwright", db: "database sql d1", mcp: "server tool tools" };

const words = (s) => String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w));

// Parses "---\nname: x\ndescription: y\n---\nbody". Returns { name, description, body }.
export function parseSkill(text) {
  const raw = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!raw) throw new Error("empty skill");
  if (estimateTokens(raw) > MAX_TOKENS) throw new Error("skill is about " + estimateTokens(raw) + " tokens; the limit is " + MAX_TOKENS + ". Shorten it or move detail out.");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const head = m ? m[1] : "";
  const pick = (key) => {
    const r = head.match(new RegExp("^" + key + ":\\s*(.*)$", "m"));
    return r ? r[1].trim().replace(/^["']|["']$/g, "") : "";
  };
  const name = pick("name");
  const description = pick("description");
  if (!NAME_RE.test(name)) throw new Error("the SKILL.md header needs a name: using letters, digits, dots, dashes (for example name: remotion-video)");
  if (description.length < 8) throw new Error("the SKILL.md header needs a description that says when to use it (starting with \"Use when\" works well)");
  if (description.length > 1024) throw new Error("the description is too long (1024 characters at most). Keep it to the trigger.");
  if (!/\buse\b/i.test(description)) throw new Error("the description should start with \"Use when ...\" so agents know when to load the skill");
  return { name, description, body: (m ? m[2] : raw).trim() };
}

// Simple warnings for risky patterns. Warnings only; the owner decides.
export function scanSkill(body) {
  const checks = [
    [/curl[^\n|]*\|\s*(ba)?sh/i, "pipes a download into a shell"],
    [/rm\s+-rf\s+[\/~]/i, "deletes folders with rm -rf"],
    [/\.env\b|id_rsa|\.ssh|api[_-]?key|secret/i, "mentions secrets or keys"],
    [/ignore (all )?(previous|prior) instructions/i, "tries to override other instructions"],
    [/base64\s+-d|eval\(/i, "runs hidden or encoded code"],
    [/https?:\/\/[^\s)]+/i, "contains links (check them)"],
  ];
  return checks.filter(([re]) => re.test(body)).map(([, msg]) => msg);
}

export async function listSkills(env) {
  const { results } = await env.DB.prepare(
    "SELECT name, description, body, enabled, core, source, created, updated FROM skills ORDER BY name"
  ).all();
  return results.map((s) => ({ name: s.name, description: s.description, enabled: !!s.enabled, core: !!s.core,
    source: s.source, pending: !s.enabled && String(s.source).startsWith("agent"),
    created: s.created, updated: s.updated, tokens: estimateTokens(s.body) }));
}

// Owner uploads go live at once. Agent uploads wait for the owner to switch them on (review).
export async function addSkill(env, text, source = "paste") {
  let s;
  try { s = parseSkill(text); } catch (e) { return { error: e.message }; }
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM skills").first();
  if (count.n >= MAX_SKILLS) return { error: "the library is full (" + MAX_SKILLS + " skills). Delete one first." };
  const exists = await env.DB.prepare("SELECT name FROM skills WHERE name = ?").bind(s.name).first();
  if (exists) return { error: "a skill named " + s.name + " already exists (delete it first to replace it)" };
  const fromAgent = String(source).startsWith("agent");
  const t = now();
  await env.DB.prepare(
    "INSERT INTO skills (name, description, body, enabled, core, source, created, updated) VALUES (?, ?, ?, ?, 0, ?, ?, ?)"
  ).bind(s.name, s.description, s.body, fromAgent ? 0 : 1, String(source).slice(0, 80), t, t).run();
  return { ok: true, name: s.name, tokens: estimateTokens(s.body), pending: fromAgent, warnings: scanSkill(s.body) };
}

// Called by an agent over MCP. Always pending until the owner approves.
export async function uploadSkillFromAgent(env, skillMd, agentName) {
  const who = "agent:" + String(agentName || "unknown").replace(/[^a-z0-9 ._-]/gi, "").slice(0, 40);
  return addSkill(env, String(skillMd || ""), who);
}

export async function setSkillFlag(env, name, flag, value) {
  if (!["enabled", "core"].includes(flag)) return { error: "unknown flag" };
  const r = await env.DB.prepare(`UPDATE skills SET ${flag} = ?, updated = ? WHERE name = ?`)
    .bind(value ? 1 : 0, now(), String(name)).run();
  return r.meta.changes ? { ok: true } : { error: "skill not found" };
}

export async function deleteSkill(env, name) {
  const r = await env.DB.prepare("DELETE FROM skills WHERE name = ?").bind(String(name)).run();
  return { deleted: r.meta.changes };
}

async function skillSettings(env) {
  const max = Math.min(8, Math.max(1, Number(await getConfig(env, "skills_max")) || DEFAULT_MAX));
  return { max };
}
export async function setSkillMax(env, n) {
  await setConfig(env, "skills_max", String(Math.min(8, Math.max(1, Number(n) || DEFAULT_MAX))));
  return skillSettings(env);
}
export const getSkillSettings = skillSettings;

// Keyword score. A word the user typed counts 2; a word added only by a synonym counts 1.
// A skill needs at least 2 points, so one loose synonym match never picks a skill on its own.
function rank(prompt, skills) {
  const direct = new Set(words(prompt));
  const extra = new Set();
  for (const k of Object.keys(SYN)) if (direct.has(k)) SYN[k].split(" ").forEach((x) => extra.add(x));
  return skills
    .map((s) => {
      const hay = new Set(words(s.name + " " + s.description));
      let sc = 0;
      for (const x of direct) if (hay.has(x)) sc += 2;
      for (const x of extra) if (!direct.has(x) && hay.has(x)) sc += 1;
      return { ...s, sc };
    })
    .filter((s) => s.sc >= 2)
    .sort((a, b) => b.sc - a.sc || a.name.localeCompare(b.name));
}

// Core skills are always sent (when enabled). Everything else competes for the remaining slots.
export async function selectSkills(env, { request = "", files = [], functions = [] } = {}, { useGemini = true } = {}) {
  const t0 = Date.now();
  const { max } = await skillSettings(env);
  const all = (await env.DB.prepare("SELECT name, description, body, core FROM skills WHERE enabled = 1 ORDER BY name").all()).results;
  const core = all.filter((s) => s.core);
  const pool = all.filter((s) => !s.core);
  const extra = [...files.map((f) => String(f).split("/").pop()), ...functions].join(" ");
  const ranked = rank(String(request) + " " + extra, pool);
  const byName = new Map(all.map((s) => [s.name, s]));

  let mode = "keywords", note = "", picks = ranked.slice(0, max).map((s) => ({ name: s.name, why: "Its name or description matches the request." }));

  if (useGemini && all.length && (await env.DB.prepare("SELECT 1 FROM gemini_keys WHERE enabled = 1 UNION ALL SELECT 1 FROM openrouter_keys WHERE enabled = 1 LIMIT 1").first())) {
    const candidates = (ranked.length ? ranked : pool).slice(0, CANDIDATES);
    if (candidates.length) {
      const idx = candidates.map((s) => "- " + s.name + ": " + s.description).join("\n");
      const prompt = "You choose agent skills for a coding agent. Pick at most " + max +
        " skills from the list that are truly needed for the request; fewer if unsure; none if no skill is needed. " +
        "Never invent names. Reply ONLY with JSON: {\"skills\":[{\"name\":\"...\",\"why\":\"one plain sentence\"}],\"note\":\"one short sentence\"}\n\n" +
        "Request: " + String(request).slice(0, 4000) +
        (files.length ? "\nFiles to edit: " + files.slice(0, 20).join(", ") : "") +
        (functions.length ? "\nFunctions in them: " + functions.slice(0, 40).join(", ") : "") +
        "\n\nSkills:\n" + idx;
      const g = await complete(env, prompt);
      if (g.error) {
        note = "AI model unavailable (" + g.error + "). Used keywords instead.";
      } else {
        try {
          const s = g.text;
          const o = JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1));
          const allowed = new Set(candidates.map((c) => c.name));
          picks = (o.skills || []).filter((x) => allowed.has(x.name)).slice(0, max)
            .map((x) => ({ name: String(x.name), why: String(x.why || "").slice(0, 220) }));
          note = String(o.note || "").slice(0, 200);
          mode = "ai";
        } catch {
          note = "The AI model returned an unreadable answer. Used keywords instead.";
        }
      }
    }
  }

  const chosen = [...core.map((s) => ({ name: s.name, why: "Always on." })), ...picks.filter((p) => byName.has(p.name))];
  const seen = new Set();
  const out = chosen.filter((p) => (seen.has(p.name) ? false : seen.add(p.name))).map((p) => {
    const s = byName.get(p.name);
    return { name: p.name, why: p.why, description: s.description, body: s.body };
  });
  return { mode, note, ms: Date.now() - t0, skills: out };
}

// The text an agent receives: a short header, then each chosen SKILL.md, nothing else.
export function formatForAgent(result) {
  if (!result.skills.length) return "GENIE: no extra skill is needed for this request. Continue without skills.";
  const head = "GENIE SKILL SELECTION (" + (result.mode === "ai" ? "chosen by an AI model" : "chosen by keywords") + "). " +
    "Follow ONLY the skills below. Do not look for other skills.\n";
  return head + result.skills.map((s) => "\n===== SKILL: " + s.name + " =====\n" + s.body).join("\n");
}
