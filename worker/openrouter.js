// OpenRouter: keys, models and rotation (shared implementation in compat.js).
// Browsing only lists FREE models (both prompt and completion price are 0).
import { makeCompat, readChat } from "./compat.js";

// Free = both prices are exactly zero. OpenRouter sends prices as strings.
export const isFree = (m) => !!m && !!m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0;

export function freeModels(data) {
  return ((data && data.data) || [])
    .filter(isFree)
    .map((m) => ({ id: String(m.id), name: String(m.name || m.id), context: Number(m.context_length) || 0 }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export const compat = makeCompat({
  id: "openrouter", label: "OpenRouter", base: "https://openrouter.ai/api/v1", rrKey: "or_rr",
  headers: { "HTTP-Referer": "https://memory-relay.workers.dev", "X-Title": "Memory Relay" },
  checkKey: (k) => (k.startsWith("sk-or-") ? null : "an OpenRouter key starts with sk-or-"),
  filterModels: freeModels,
});
export const listFreeModels = compat.list;
export const openrouter = compat.call;
export const openrouterState = compat.state;
export const openrouterOp = compat.op;
export const readOpenRouter = readChat;
