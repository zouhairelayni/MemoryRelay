// Providers that speak the OpenAI chat-completions protocol (OpenRouter, OpenAI, NVIDIA): one implementation,
// each with its own keys, models and cooldowns (tables <prefix>_keys, <prefix>_models, <prefix>_cooldowns).
// A request tries each enabled model in order and, for each model, the keys in turn starting from a
// round-robin position. 429 cools that key+model down, 5xx and network errors retry once, 401/403 disable the key.
import { MAX_CALLS, RETRYABLE } from "./constants.js";
import { AI_FAST, AI_LONG, fetchIdle, isSse, sseEvents } from "./aifetch.js";
import { getConfig, setConfig } from "./db.js";
import { newId, now, runAll, safeJson, sleep, readObject } from "./util.js";

// Reads a chat-completions answer, streamed (SSE) or whole (JSON).
export function readChat(body) {
  const events = isSse(body) ? sseEvents(body) : [safeJson(body, null)];
  let text = "", finish = "";
  for (const d of events) {
    const c = d && d.choices && d.choices[0];
    if (!c) continue;
    text += (c.message && c.message.content) || (c.delta && c.delta.content) || "";
    if (c.finish_reason) finish = c.finish_reason;
  }
  return { text, truncated: finish === "length" };
}

const DAILY = /per.?day|daily|free-models-per|insufficient_quota|exceeded your current quota/i;

// cfg: { id, label, base, prefix, rrKey, headers, checkKey(key) -> error|null, filterModels(data) -> [{id,name,context}],
//        tokenParam, sendTemperature, paid }
export function makeCompat(cfg) {
  const { id, label, base, rrKey, headers = {}, checkKey = () => null, filterModels, tokenParam = "max_tokens", sendTemperature = true, paid = false } = cfg;
  const prefix = cfg.prefix || id;
  const T = { keys: prefix + "_keys", models: prefix + "_models", cool: prefix + "_cooldowns" }; // fixed names, never user input

  async function list(key) {
    let r;
    try {
      r = await fetch(base + "/models", { headers: key ? { authorization: "Bearer " + key, ...headers } : headers, signal: AbortSignal.timeout(20000) });
    } catch {
      return { error: "could not reach " + label + " (network error)" };
    }
    if (!r.ok) return { error: label + " returned HTTP " + r.status + (r.status === 401 ? " (check the key)" : "") };
    return { models: filterModels(await r.json().catch(() => null)) };
  }

  function once(key, model, prompt, opts) {
    const messages = [...(opts.system ? [{ role: "system", content: String(opts.system) }] : []), { role: "user", content: prompt }];
    const body = { model, messages };
    if (opts.maxTokens) body[tokenParam] = opts.maxTokens;
    if (sendTemperature) body.temperature = opts.temperature ?? 0.1;
    else if (opts.temperature !== undefined) body.temperature = opts.temperature;
    if (opts.long) body.stream = true;
    return fetchIdle(base + "/chat/completions", {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + key, ...headers }, body: JSON.stringify(body),
    }, opts.long ? AI_LONG : AI_FAST).catch((e) => ({ ok: false, status: 0, text: async () => String((e && e.message) || e) }));
  }

  async function cooldown(env, keyId, model, ms) {
    await env.DB.prepare(`INSERT INTO ${T.cool} (key_id, model, until) VALUES (?, ?, ?) ON CONFLICT(key_id, model) DO UPDATE SET until = excluded.until`)
      .bind(keyId, model, Date.now() + ms).run();
  }

  // opts: { system, maxTokens, temperature, long, onlyModel }
  async function call(env, prompt, opts = {}) {
    const keys = (await env.DB.prepare(`SELECT id, label, key FROM ${T.keys} WHERE enabled = 1 ORDER BY created`).all()).results;
    let models = (await env.DB.prepare(`SELECT name FROM ${T.models} WHERE enabled = 1 ORDER BY pos, name`).all()).results.map((m) => m.name);
    if (!keys.length) return { error: "no enabled " + label + " key" };
    if (opts.onlyModel) models = models.filter((m) => m === opts.onlyModel);
    if (!models.length) return { error: opts.onlyModel ? "model " + opts.onlyModel + " is not enabled for " + label : "no enabled " + label + " model (add one in the dashboard)" };

    const cool = await env.DB.prepare(`SELECT key_id, model FROM ${T.cool} WHERE until > ?`).bind(Date.now()).all();
    const cooling = new Set(cool.results.map((c) => c.key_id + "|" + c.model));
    const rr = Number(await getConfig(env, rrKey)) || 0;
    await setConfig(env, rrKey, String(rr + 1));
    const rotated = keys.map((_, i) => keys[(rr + i) % keys.length]);

    const log = [];
    let calls = 0;
    const t0 = Date.now(), budget = (opts.long ? AI_LONG : AI_FAST).deadlineMs;
    for (const model of models) {
      for (const k of rotated) {
        const tag = `${label} ${k.label}/${model}`;
        if (Date.now() - t0 > budget) { log.push("time budget used up"); return { error: log.join("; ") }; }
        if (cooling.has(k.id + "|" + model)) { log.push(`${tag}: cooling down`); continue; }
        if (calls >= MAX_CALLS) { log.push("attempt limit reached"); return { error: log.join("; ") }; }
        calls++;
        let r = await once(k.key, model, prompt, opts);
        if (RETRYABLE.has(r.status) && calls < MAX_CALLS && Date.now() - t0 < budget / 2) { await sleep(1500); calls++; r = await once(k.key, model, prompt, opts); }
        if (r.ok) {
          const a = readChat(await r.text());
          if (a.text) return { text: a.text, model, key: k.label, provider: id, truncated: a.truncated };
          log.push(`${tag}: empty reply`);
          continue;
        }
        const text = await r.text();
        if (r.status === 429) {
          const daily = DAILY.test(text);
          await cooldown(env, k.id, model, daily ? 6 * 3600e3 : 60e3);
          log.push(`${tag}: 429 rate limited${daily ? " (daily limit, cooling 6h)" : ""}`);
        } else if (r.status === 401 || r.status === 403) {
          await env.DB.prepare(`UPDATE ${T.keys} SET enabled = 0 WHERE id = ?`).bind(k.id).run();
          log.push(`${tag}: key rejected, disabled`);
        } else {
          log.push(`${tag}: ${r.status ? "HTTP " + r.status : "network error (" + text.slice(0, 90) + ")"}${RETRYABLE.has(r.status) ? " (after retry)" : ""}`);
        }
      }
    }
    return { error: log.join("; ") || "no attempt made" };
  }

  async function state(env) {
    const keys = (await env.DB.prepare(`SELECT id, label, key, enabled FROM ${T.keys} ORDER BY created`).all()).results;
    const models = (await env.DB.prepare(`SELECT name, enabled FROM ${T.models} ORDER BY pos, name`).all()).results;
    const cool = (await env.DB.prepare(`SELECT key_id, model FROM ${T.cool} WHERE until > ?`).bind(Date.now()).all()).results;
    return {
      keys: keys.map((k) => ({ id: k.id, label: k.label, tail: k.key.slice(-4), enabled: !!k.enabled, cooling: cool.filter((c) => c.key_id === k.id).map((c) => c.model) })),
      models: models.map((m) => ({ name: m.name, enabled: !!m.enabled })),
    };
  }

  async function op(env, request) {
    const b = await readObject(request);
    switch (b.op) {
      case "add_key": {
        const key = String(b.key || "").trim();
        if (!key) return { error: "paste a key" };
        if (key.length > 400 || /\s/.test(key)) return { error: "that does not look like a key" };
        const bad = checkKey(key);
        if (bad) return { error: bad };
        await env.DB.prepare(`INSERT OR IGNORE INTO ${T.keys} (id, label, key, created) VALUES (?, ?, ?, ?)`)
          .bind(newId(), String(b.label || id).trim().slice(0, 40) || id, key, now()).run();
        break;
      }
      case "delete_key": await env.DB.prepare(`DELETE FROM ${T.keys} WHERE id = ?`).bind(String(b.id)).run(); break;
      case "toggle_key": await env.DB.prepare(`UPDATE ${T.keys} SET enabled = 1 - enabled WHERE id = ?`).bind(String(b.id)).run(); break;
      case "add_model": {
        const name = String(b.name || "").trim();
        if (!name) return { error: "pick a model" };
        if (name.length > 200) return { error: "that model name is too long" };
        await env.DB.prepare(`INSERT OR IGNORE INTO ${T.models} (name, enabled, pos) VALUES (?, 1, (SELECT COALESCE(MAX(pos), 0) + 1 FROM ${T.models}))`).bind(name).run();
        break;
      }
      case "delete_model": await env.DB.prepare(`DELETE FROM ${T.models} WHERE name = ?`).bind(String(b.name)).run(); break;
      case "toggle_model": await env.DB.prepare(`UPDATE ${T.models} SET enabled = 1 - enabled WHERE name = ?`).bind(String(b.name)).run(); break;
      case "move_model": {
        const { results } = await env.DB.prepare(`SELECT name FROM ${T.models} ORDER BY pos, name`).all();
        const names = results.map((r) => r.name);
        const i = names.indexOf(String(b.name)), j = i + Number(b.dir);
        if (i < 0 || j < 0 || j >= names.length) break;
        [names[i], names[j]] = [names[j], names[i]];
        await runAll(env, names.map((n, pos) => env.DB.prepare(`UPDATE ${T.models} SET pos = ? WHERE name = ?`).bind(pos, n)));
        break;
      }
      default: return { error: "unknown op" };
    }
    return state(env);
  }

  const counts = (env) => env.DB.prepare(`SELECT (SELECT COUNT(*) FROM ${T.keys} WHERE enabled = 1) AS keys, (SELECT COUNT(*) FROM ${T.models} WHERE enabled = 1) AS models`).first();
  return { id, label, paid, list, call, state, op, counts, tables: T };
}
