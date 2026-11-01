// Every AI provider in one place. Gemini has its own protocol; the others share compat.js.
import { geminiOp, geminiState, gemini, listGeminiModels } from "./gemini.js";
import { makeCompat } from "./compat.js";
import { compat as openrouter } from "./openrouter.js";

const sortById = (a) => a.sort((x, y) => x.id.localeCompare(y.id));
const asModels = (data, keep) => sortById(((data && data.data) || []).map((m) => String(m.id)).filter(keep).map((id) => ({ id, name: id, context: 0 })));

export const openai = makeCompat({
  id: "openai", label: "OpenAI", base: "https://api.openai.com/v1", rrKey: "oa_rr", paid: true,
  tokenParam: "max_completion_tokens", sendTemperature: false, // newer models reject max_tokens and a custom temperature
  checkKey: (k) => (k.startsWith("sk-") && !k.startsWith("sk-or-") ? null : "an OpenAI key starts with sk-"),
  filterModels: (d) => asModels(d, (id) => /^(gpt-|o\d|chatgpt-)/.test(id) && !/embed|tts|whisper|audio|realtime|transcribe|moderation|image|dall|search|instruct|davinci|babbage|computer-use/i.test(id)),
});

export const nvidia = makeCompat({
  id: "nvidia", label: "NVIDIA", base: "https://integrate.api.nvidia.com/v1", rrKey: "nv_rr",
  checkKey: (k) => (k.startsWith("nvapi-") ? null : "an NVIDIA key starts with nvapi-"),
  filterModels: (d) => asModels(d, (id) => !/embed|rerank|reward|guard|clip|parse|retriev|riva|vila|image|video|audio|speech|asr|tts|ocr|nemoguard/i.test(id)),
});

// Providers that use the OpenAI chat protocol, by id. Routes and the dashboard are generated from this.
export const COMPAT = { openrouter, nvidia, openai };

export const PROVIDER_IDS = ["gemini", "openrouter", "nvidia", "openai"];
export const PROVIDER_LABEL = { gemini: "Gemini", openrouter: "OpenRouter", nvidia: "NVIDIA", openai: "OpenAI" };

// Calls one provider by id. Same result shape for all: { text, model, key, provider } or { error }.
export async function callProvider(env, id, prompt, opts = {}) {
  if (id === "gemini") { const g = await gemini(env, prompt, opts); return g.error ? g : { ...g, provider: "gemini" }; }
  const c = COMPAT[id];
  return c ? c.call(env, prompt, opts) : { error: "unknown provider " + id };
}

export { geminiOp, geminiState, listGeminiModels };
