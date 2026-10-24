// OpenRouter: keys, models and rotation, mirroring the Gemini pool.
// Browsing only lists FREE models (both prompt and completion price are 0).
import { MAX_CALLS, RETRYABLE } from "./constants.js";
import { getConfig, setConfig } from "./db.js";
import { newId, now, runAll, sleep } from "./util.js";

const BASE = "https://openrouter.ai/api/v1";
const HEADERS = { "HTTP-Referer": "https://memory-relay.workers.dev", "X-Title": "Memory Relay" };

// Free = both prices are exactly zero. OpenRouter sends prices as strings.
export const isFree = (m) => !!m && !!m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0;

export function freeModels(data) {
  return ((data && data.data) || [])
    .filter(isFree)
    .map((m) => ({ id: String(m.id), name: String(m.name || m.id), context: Number(m.context_length) || 0 }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// Browse: free models only. The key is optional (the list is public).
export async function listFreeModels(key) {
  let r;
  try {
    r = await fetch(BASE + "/models", { headers: key ? { authorization: "Bearer " + key, ...HEADERS } : HEADERS });
  } catch {
    return { error: "could not reach OpenRouter (network error)" };
  }
  if (!r.ok) return { error: "OpenRouter returned HTTP " + r.status };
  const models = freeModels(await r.json());
  return { models };
}

async function callOpenRouter(key, model, prompt) {
  try {
    return await fetch(BASE + "/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + key, ...HEADERS },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], temperature: 0.1 }),
    });
  } catch (e) {
    return { ok: false, status: 0, json: async () => ({}), text: async () => String((e && e.message) || e) };
  }
}

async function setCooldown(env, keyId, model, ms) {
  await env.DB.prepare(
    "INSERT INTO openrouter_cooldowns (key_id, model, until) VALUES (?, ?, ?) ON CONFLICT(key_id, model) DO UPDATE SET until = excluded.until"
  ).bind(keyId, model, Date.now() + ms).run();
}

// Same policy as Gemini: rotate keys per model, cool down on 429, one retry on 5xx/network, disable bad keys.
export async function openrouter(env, prompt) {
  const keys = (await env.DB.prepare("SELECT id, label, key FROM openrouter_keys WHERE enabled = 1 ORDER BY created").all()).results;
  const models = (await env.DB.prepare("SELECT name FROM openrouter_models WHERE enabled = 1 ORDER BY pos, name").all()).results.map((m) => m.name);
  if (!keys.length) return { error: "no enabled OpenRouter key" };
  if (!models.length) return { error: "no enabled OpenRouter model (browse free models in the dashboard)" };

  const cool = await env.DB.prepare("SELECT key_id, model FROM openrouter_cooldowns WHERE until > ?").bind(Date.now()).all();
  const cooling = new Set(cool.results.map((c) => c.key_id + "|" + c.model));
  const rr = Number(await getConfig(env, "or_rr")) || 0;
  await setConfig(env, "or_rr", String(rr + 1));
  const rotated = keys.map((_, i) => keys[(rr + i) % keys.length]);

  const log = [];
  let calls = 0;
  for (const model of models) {
    for (const k of rotated) {
      const tag = `OpenRouter ${k.label}/${model}`;
      if (cooling.has(k.id + "|" + model)) { log.push(`${tag}: cooling down`); continue; }
      if (calls >= MAX_CALLS) { log.push("attempt limit reached"); return { error: log.join("; ") }; }
      calls++;
      let r = await callOpenRouter(k.key, model, prompt);
      if (RETRYABLE.has(r.status) && calls < MAX_CALLS) {
        await sleep(1500);
        calls++;
        r = await callOpenRouter(k.key, model, prompt);
      }
      if (r.ok) {
        const d = await r.json();
        const text = d?.choices?.[0]?.message?.content;
        if (text) return { text, model, key: k.label, provider: "openrouter" };
        log.push(`${tag}: empty reply`);
        continue;
      }
      const body = await r.text();
      if (r.status === 429) {
        const daily = /per.?day|daily|free-models-per/i.test(body);
        await setCooldown(env, k.id, model, daily ? 6 * 3600e3 : 60e3);
        log.push(`${tag}: 429 rate limited${daily ? " (daily limit, cooling 6h)" : ""}`);
      } else if (r.status === 401 || r.status === 403) {
        await env.DB.prepare("UPDATE openrouter_keys SET enabled = 0 WHERE id = ?").bind(k.id).run();
        log.push(`${tag}: key rejected, disabled`);
      } else {
        log.push(`${tag}: ${r.status ? "HTTP " + r.status : "network error"}${RETRYABLE.has(r.status) ? " (after retry)" : ""}`);
      }
    }
  }
  return { error: log.join("; ") || "no attempt made" };
}

export async function openrouterState(env) {
  const keys = (await env.DB.prepare("SELECT id, label, key, enabled FROM openrouter_keys ORDER BY created").all()).results;
  const models = (await env.DB.prepare("SELECT name, enabled FROM openrouter_models ORDER BY pos, name").all()).results;
  const cool = (await env.DB.prepare("SELECT key_id, model FROM openrouter_cooldowns WHERE until > ?").bind(Date.now()).all()).results;
  return {
    keys: keys.map((k) => ({ id: k.id, label: k.label, tail: k.key.slice(-4), enabled: !!k.enabled,
      cooling: cool.filter((c) => c.key_id === k.id).map((c) => c.model) })),
    models: models.map((m) => ({ name: m.name, enabled: !!m.enabled })),
  };
}

export async function openrouterOp(env, request) {
  const b = await request.json().catch(() => ({}));
  switch (b.op) {
    case "add_key": {
      const key = String(b.key || "").trim();
      if (!key) return { error: "paste a key" };
      if (!key.startsWith("sk-or-")) return { error: "an OpenRouter key starts with sk-or-" };
      await env.DB.prepare("INSERT OR IGNORE INTO openrouter_keys (id, label, key, created) VALUES (?, ?, ?, ?)")
        .bind(newId(), String(b.label || "openrouter").trim().slice(0, 40) || "openrouter", key, now()).run();
      break;
    }
    case "delete_key": await env.DB.prepare("DELETE FROM openrouter_keys WHERE id = ?").bind(String(b.id)).run(); break;
    case "toggle_key": await env.DB.prepare("UPDATE openrouter_keys SET enabled = 1 - enabled WHERE id = ?").bind(String(b.id)).run(); break;
    case "add_model": {
      const name = String(b.name || "").trim();
      if (!name) return { error: "pick a model" };
      await env.DB.prepare(
        "INSERT OR IGNORE INTO openrouter_models (name, enabled, pos) VALUES (?, 1, (SELECT COALESCE(MAX(pos), 0) + 1 FROM openrouter_models))"
      ).bind(name).run();
      break;
    }
    case "delete_model": await env.DB.prepare("DELETE FROM openrouter_models WHERE name = ?").bind(String(b.name)).run(); break;
    case "toggle_model": await env.DB.prepare("UPDATE openrouter_models SET enabled = 1 - enabled WHERE name = ?").bind(String(b.name)).run(); break;
    case "move_model": {
      const { results } = await env.DB.prepare("SELECT name FROM openrouter_models ORDER BY pos, name").all();
      const names = results.map((r) => r.name);
      const i = names.indexOf(String(b.name)), j = i + Number(b.dir);
      if (i < 0 || j < 0 || j >= names.length) break;
      [names[i], names[j]] = [names[j], names[i]];
      await runAll(env, names.map((n, pos) => env.DB.prepare("UPDATE openrouter_models SET pos = ? WHERE name = ?").bind(pos, n)));
      break;
    }
    default: return { error: "unknown op" };
  }
  return openrouterState(env);
}
