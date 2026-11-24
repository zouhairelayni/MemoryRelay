// Shared with the dashboard and Worker. This is a conservative UTF-8 estimate,
// not a model-specific tokenizer: each provider may count tokens differently.
export const DEFAULT_MEMORY_TOKENS = 1000;
export const MIN_MEMORY_TOKENS = 100;
export const MAX_MEMORY_TOKENS = 8000;
export const MAX_MEMORY_TEXT_CHARS = 32000; // independent input/DB safety bound

export function estimateMemoryTokens(value) {
  const text = String(value || "");
  if (!text) return 0;
  const utf8 = new TextEncoder().encode(text).length;
  const words = (text.match(/\S+/g) || []).length;
  return Math.ceil(Math.max(utf8 / 3, words * 1.3));
}

export function memoryTextError(value, maxTokens) {
  const text = String(value || "");
  if (text.length > MAX_MEMORY_TEXT_CHARS) return `over ${MAX_MEMORY_TEXT_CHARS} characters (safety bound)`;
  const tokens = estimateMemoryTokens(text);
  if (tokens > maxTokens) return `over ${maxTokens} estimated tokens (${tokens} estimated)`;
  return "";
}
