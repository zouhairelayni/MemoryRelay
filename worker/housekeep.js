// Duplicate detection and merge through Gemini.
import { MAX_LEN } from "./constants.js";
import { complete } from "./llm.js";
import { now, runAll } from "./util.js";

export async function housekeep(env, a) {
  const { results } = await env.DB.prepare(
    "SELECT id, text FROM memories WHERE tags NOT LIKE '%rules%' ORDER BY created DESC, rowid DESC LIMIT 200"
  ).all();
  if (!results.length) {
    const rules = await env.DB.prepare("SELECT COUNT(*) AS n FROM memories WHERE tags LIKE '%rules%'").first();
    return { message: "no editable memories: housekeeping skips rules-tagged memories", rules_memories: rules.n };
  }
  const prompt = 'You maintain a list of memories. Find groups that duplicate or contradict each other. Reply ONLY with JSON: {"groups":[{"keep":"id","drop":["id"],"merged_text":"...","reason":"..."}]}. If none, reply {"groups":[]}.\n\nMEMORIES:\n' + JSON.stringify(results);
  const byId = new Map(results.map((m) => [m.id, m]));
  let groups, model = "", keyLabel = "";
  if (a.apply && Array.isArray(a.groups)) {
    groups = a.groups; // dashboard: apply exactly what the user saw in the preview
  } else {
    const g = await complete(env, prompt);
    if (g.error) return { error: g.error };
    try {
      const s = g.text;
      groups = JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1)).groups || [];
    } catch {
      return { error: "model returned invalid JSON", model: g.model };
    }
    model = g.model;
    keyLabel = g.key;
  }
  // Keep only valid groups: ids must exist and must not be rules memories.
  groups = groups.map((grp) => {
    const keep = String(grp && grp.keep || "");
    return {
      keep,
      drop: (Array.isArray(grp && grp.drop) ? grp.drop : []).map(String).filter((d) => d !== keep && byId.has(d)),
      merged_text: String(grp && grp.merged_text || "").trim(),
      reason: String(grp && grp.reason || ""),
    };
  }).filter((grp) => byId.has(grp.keep) && grp.drop.length);
  if (!a.apply) {
    if (!groups.length) return { model, key: keyLabel, proposed: [], message: "No duplicates found." };
    return {
      model, key: keyLabel,
      proposed: groups.map((grp) => ({
        ...grp,
        keep_text: byId.get(grp.keep).text,
        drop_texts: grp.drop.map((d) => byId.get(d).text),
      })),
    };
  }
  const drop = new Set();
  const stmts = [];
  let updated = 0;
  for (const grp of groups) {
    if (!byId.has(grp.keep)) continue;
    for (const d of grp.drop || []) if (d !== grp.keep && byId.has(d)) drop.add(d);
    const merged = String(grp.merged_text || "").trim();
    if (merged && merged.length <= MAX_LEN) {
      updated++;
      stmts.push(env.DB.prepare(
        "UPDATE memories SET history = json_insert(history, '$[#]', json_object('text', text, 'time', updated)), text = ?, updated = ? WHERE id = ?"
      ).bind(merged, now(), grp.keep));
    }
  }
  for (const d of drop) stmts.push(env.DB.prepare("DELETE FROM memories WHERE id = ?").bind(d));
  await runAll(env, stmts);
  return { model, key: keyLabel, removed: drop.size, merged: updated };
}
