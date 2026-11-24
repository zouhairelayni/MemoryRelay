// Owner-adjustable memory context limit, persisted in D1 and read at use time.
import { getConfig, setConfig } from "./db.js";
import { DEFAULT_MEMORY_TOKENS, MIN_MEMORY_TOKENS, MAX_MEMORY_TOKENS } from "../shared/memoryBudget.js";

const KEY = "memory_max_tokens";
export async function getMemoryLimit(env) {
  const raw = await getConfig(env, KEY);
  const n = Number(raw);
  return raw !== null && Number.isInteger(n) && n >= MIN_MEMORY_TOKENS && n <= MAX_MEMORY_TOKENS
    ? n : DEFAULT_MEMORY_TOKENS;
}
export async function setMemoryLimit(env, value) {
  // Reject fractions, coercion surprises and extreme values before persisting.
  if (typeof value !== "number" || !Number.isInteger(value) || value < MIN_MEMORY_TOKENS || value > MAX_MEMORY_TOKENS)
    return { error: `Choose a whole number of estimated tokens between ${MIN_MEMORY_TOKENS} and ${MAX_MEMORY_TOKENS}.` };
  await setConfig(env, KEY, String(value));
  return { ok: true, max_tokens: value };
}
