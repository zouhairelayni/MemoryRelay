// One entry point for "ask an AI model". Gemini first, then OpenRouter. Used by housekeeping and skill picks.
import { gemini } from "./gemini.js";
import { openrouter } from "./openrouter.js";

export async function complete(env, prompt) {
  const g = await gemini(env, prompt);
  if (!g.error) return { ...g, provider: "gemini" };
  const o = await openrouter(env, prompt);
  if (!o.error) return o;
  return { error: "Gemini: " + g.error + " | OpenRouter: " + o.error };
}
