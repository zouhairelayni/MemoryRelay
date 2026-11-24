// Shared conservative token estimate for skill sizes (not the memory context budget).
export function estimateTokens(text) {
  const t = String(text || "");
  const words = (t.match(/\S+/g) || []).length;
  return Math.ceil(Math.max(t.length / 4, words * 1.3));
}
