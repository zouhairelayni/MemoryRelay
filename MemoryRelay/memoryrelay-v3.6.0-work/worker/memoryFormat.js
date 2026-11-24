/** Stable Markdown format for newly created agent memories.
 * Dashboard/user-authored content remains untouched. Existing memories are not migrated.
 * Storage is plain Markdown text, not HTML; editing is lossless.
 */
export const AGENT_MEMORY_GUIDANCE = "Write structured Markdown: begin with a **bold, specific title**, then short '- *Label:* fact' bullets. Preserve terminal commands in fenced ```bash blocks so the owner can copy them. Include only durable facts, never secrets or entire conversations.";

export function formatAgentMemory(input) {
  const text = String(input || "").trim();
  if (!text) return "";
  // Agents can choose an H1–H4 heading or a bold title. Already structured facts remain unchanged.
  if (/^(?:\*\*[^\n*]+\*\*|#{1,4}\s+[^\n]+)/.test(text)) return text;
  // Plain-text legacy client calls are upgraded server-side without discarding the supplied content.
  // Never interpret or execute Markdown; the UI uses a safe text-node renderer.
  const first = text.split("\n").find(s => s.trim()) || "Memory";
  const shortTitle = first.replace(/^[\s*#>-]+/, "").replace(/[`*_\[\]\\]/g, "").slice(0, 72).trim() || "Memory note";
  return `**${shortTitle}**\n- *Detail:* ${text}`;
}
