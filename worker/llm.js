// One entry point for "ask an AI model" (housekeeping, skill picks, Skill Studio).
// Providers are tried in the owner's routing order (default: Gemini, OpenRouter, NVIDIA). OpenAI is paid, so it is only
// used here when the owner adds it to the order.
import { getConfig } from "./db.js";
import { PROVIDER_IDS, PROVIDER_LABEL, callProvider } from "./providers.js";

export const DEFAULT_ORDER = ["gemini", "openrouter", "nvidia"];

export async function routingOrder(env) {
  const raw = String((await getConfig(env, "ai_order")) || "").split(",").map((s) => s.trim()).filter((s) => PROVIDER_IDS.includes(s));
  return raw.length ? [...new Set(raw)] : DEFAULT_ORDER;
}

// opts: { json: false } for plain text, { maxTokens, temperature, system, long, onlyModel }.
export async function complete(env, prompt, opts = {}) {
  const errors = [];
  for (const id of await routingOrder(env)) {
    const r = await callProvider(env, id, prompt, opts);
    if (!r.error) return r;
    errors.push(PROVIDER_LABEL[id] + ": " + r.error);
  }
  return { error: errors.join(" | ") };
}
