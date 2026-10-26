// Same estimate the server uses (the larger of chars/4 and words x 1.3), so the counter matches the limit.
export function estimateTokens(text) {
  const t = String(text || "");
  const words = (t.match(/\S+/g) || []).length;
  return Math.ceil(Math.max(t.length / 4, words * 1.3));
}
