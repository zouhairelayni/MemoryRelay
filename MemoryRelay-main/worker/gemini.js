// Gemini key and model pools with rotation, cooldowns and retry handling.
import { MAX_CALLS, RETRYABLE } from "./constants.js";
import { AI_FAST, AI_LONG, fetchIdle, isSse, sseEvents } from "./aifetch.js";
import { getConfig, setConfig } from "./db.js";
import { newId, now, runAll, safeJson, sleep, readObject } from "./util.js";

export async function listGeminiModels(key) {
  let r;
  try {
    r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=100", {
      headers: { "x-goog-api-key": key },
    });
  } catch {
    return { error: "could not reach Gemini (network error)" };
  }
  if (!r.ok) return { error: "Gemini returned HTTP " + r.status + " (check the key)" };
  const d = await r.json();
  const models = (d.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent") && /gemini/.test(m.name))
    .map((m) => m.name.replace(/^models\//, ""));
  return { models };
}

export async function callGemini(key, model, prompt, opts = {}) {
  const generationConfig = {};
  if (opts.json !== false) generationConfig.responseMimeType = "application/json";
  if (opts.maxTokens) generationConfig.maxOutputTokens = opts.maxTokens;
  if (opts.temperature !== undefined) generationConfig.temperature = opts.temperature;
  try {
    // Long jobs stream, so every chunk proves the model is still working (see aifetch.js).
    const method = opts.long ? "streamGenerateContent?alt=sse" : "generateContent";
    return await fetchIdle(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${method}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig,
        ...(opts.system ? { systemInstruction: { parts: [{ text: String(opts.system) }] } } : {}) }),
    }, opts.long ? AI_LONG : AI_FAST);
  } catch (e) {
    // Network failure: report it like a failed response so rotation carries on to the next key or model.
    return { ok: false, status: 0, json: async () => ({}), text: async () => String((e && e.message) || e) };
  }
}

// Reads a Gemini answer, streamed (SSE) or whole (JSON).
export function readGemini(body) {
  const events = isSse(body) ? sseEvents(body) : [safeJson(body, null)];
  let text = "", finish = "";
  for (const d of events) {
    const c = d && d.candidates && d.candidates[0];
    if (!c) continue;
    text += ((c.content && c.content.parts) || []).filter((x) => !x.thought).map((x) => x.text || "").join("");
    if (c.finishReason) finish = c.finishReason;
  }
  return { text, truncated: finish === "MAX_TOKENS" };
}

export async function setCooldown(env, keyId, model, ms) {
  await env.DB.prepare(
    "INSERT INTO gemini_cooldowns (key_id, model, until) VALUES (?, ?, ?) ON CONFLICT(key_id, model) DO UPDATE SET until = excluded.until"
  ).bind(keyId, model, Date.now() + ms).run();
}

// Tries every enabled model in order; for each model, tries every enabled key
// (starting from a round-robin position). Handles 429 (cooldown), 503/5xx (one retry),
// and 401/403 (disables the key).
export async function gemini(env, prompt, opts = {}) {
  const keys = (await env.DB.prepare("SELECT id, label, key FROM gemini_keys WHERE enabled = 1 ORDER BY created").all()).results;
  let models = (await env.DB.prepare("SELECT name FROM gemini_models WHERE enabled = 1 ORDER BY pos, name").all()).results.map((m) => m.name);
  if (!keys.length) return { error: "no enabled Gemini key (add one in the dashboard)" };
  if (opts.onlyModel) models = models.filter((m) => m === opts.onlyModel);
  if (!models.length) return { error: opts.onlyModel ? "model " + opts.onlyModel + " is not enabled for Gemini" : "no enabled Gemini model (add one in the dashboard)" };

  const cool = await env.DB.prepare("SELECT key_id, model FROM gemini_cooldowns WHERE until > ?").bind(Date.now()).all();
  const cooling = new Set(cool.results.map((c) => c.key_id + "|" + c.model));

  const rr = Number(await getConfig(env, "gemini_rr")) || 0;
  await setConfig(env, "gemini_rr", String(rr + 1));
  const rotated = keys.map((_, i) => keys[(rr + i) % keys.length]);

  const log = [];
  let calls = 0;
  const t0 = Date.now(), budget = (opts.long ? AI_LONG : AI_FAST).deadlineMs;
  for (const model of models) {
    for (const k of rotated) {
      const tag = `${k.label}/${model}`;
      if (Date.now() - t0 > budget) { log.push("time budget used up"); return { error: log.join("; ") }; }
      if (cooling.has(k.id + "|" + model)) { log.push(`${tag}: cooling down`); continue; }
      if (calls >= MAX_CALLS) { log.push("attempt limit reached"); return { error: log.join("; ") }; }

      calls++;
      let r = await callGemini(k.key, model, prompt, opts);
      if (RETRYABLE.has(r.status) && calls < MAX_CALLS && Date.now() - t0 < budget / 2) {
        await sleep(1500);
        calls++;
        r = await callGemini(k.key, model, prompt, opts);
      }

      if (r.ok) {
        const a = readGemini(await r.text());
        if (a.text) return { text: a.text, model, key: k.label, truncated: a.truncated };
        log.push(`${tag}: empty reply`);
        continue;
      }

      const body = await r.text();
      if (r.status === 429) {
        const daily = /PerDay|per.?day|daily/i.test(body);
        await setCooldown(env, k.id, model, daily ? 6 * 3600e3 : 60e3);
        log.push(`${tag}: 429 rate limited${daily ? " (daily quota, cooling 6h)" : ""}`);
      } else if (r.status === 401 || r.status === 403 || /API_KEY_INVALID/.test(body)) {
        await env.DB.prepare("UPDATE gemini_keys SET enabled = 0 WHERE id = ?").bind(k.id).run();
        log.push(`${tag}: key rejected, disabled`);
      } else {
        log.push(`${tag}: ${r.status ? "HTTP " + r.status : "network error (" + body.slice(0, 90) + ")"}${RETRYABLE.has(r.status) ? " (after retry)" : ""}`);
      }
    }
  }
  return { error: log.join("; ") || "no attempt made" };
}

export async function geminiState(env) {
  const keys = (await env.DB.prepare("SELECT id, label, key, enabled FROM gemini_keys ORDER BY created").all()).results;
  const models = (await env.DB.prepare("SELECT name, enabled FROM gemini_models ORDER BY pos, name").all()).results;
  const cool = (await env.DB.prepare("SELECT key_id, model FROM gemini_cooldowns WHERE until > ?").bind(Date.now()).all()).results;
  return {
    keys: keys.map((k) => ({
      id: k.id, label: k.label, tail: k.key.slice(-4), enabled: !!k.enabled,
      cooling: cool.filter((c) => c.key_id === k.id).map((c) => c.model),
    })),
    models: models.map((m) => ({ name: m.name, enabled: !!m.enabled })),
  };
}

export async function geminiOp(env, request) {
  const b = await readObject(request);
  switch (b.op) {
    case "add_key": {
      const key = String(b.key || "").trim();
      if (!key) return { error: "paste a key" };
      await env.DB.prepare("INSERT OR IGNORE INTO gemini_keys (id, label, key, created) VALUES (?, ?, ?, ?)")
        .bind(newId(), String(b.label || "key").trim().slice(0, 40) || "key", key, now()).run();
      break;
    }
    case "delete_key":
      await env.DB.prepare("DELETE FROM gemini_keys WHERE id = ?").bind(String(b.id)).run();
      break;
    case "toggle_key":
      await env.DB.prepare("UPDATE gemini_keys SET enabled = 1 - enabled WHERE id = ?").bind(String(b.id)).run();
      break;
    case "add_model": {
      const name = String(b.name || "").trim();
      if (!name) return { error: "type a model name" };
      await env.DB.prepare(
        "INSERT OR IGNORE INTO gemini_models (name, enabled, pos) VALUES (?, 1, (SELECT COALESCE(MAX(pos), 0) + 1 FROM gemini_models))"
      ).bind(name).run();
      break;
    }
    case "delete_model":
      await env.DB.prepare("DELETE FROM gemini_models WHERE name = ?").bind(String(b.name)).run();
      break;
    case "toggle_model":
      await env.DB.prepare("UPDATE gemini_models SET enabled = 1 - enabled WHERE name = ?").bind(String(b.name)).run();
      break;
    case "move_model": {
      const { results } = await env.DB.prepare("SELECT name FROM gemini_models ORDER BY pos, name").all();
      const names = results.map((r) => r.name);
      const i = names.indexOf(String(b.name)), j = i + Number(b.dir);
      if (i < 0 || j < 0 || j >= names.length) break;
      [names[i], names[j]] = [names[j], names[i]];
      await runAll(env, names.map((n, pos) =>
        env.DB.prepare("UPDATE gemini_models SET pos = ? WHERE name = ?").bind(pos, n)));
      break;
    }
    default:
      return { error: "unknown op" };
  }
  return geminiState(env);
}
