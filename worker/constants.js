// Shared limits and the MCP tool list.

export const MAX_LEN = 500;
export const FALLBACK_MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"];
export const SESSION_DAYS = 14;
export const PBKDF2_ITER = 100000;
export const MAX_CALLS = 8; // Workers subrequest budget per request
export const RETRYABLE = new Set([0, 500, 502, 503, 504]); // 0 = could not reach Gemini at all
export const BUILD = "2026-10-23.7-react";

export const TOOLS = [
  { name: "remember", description: "Save ONE short, self-contained fact, preference, or decision (max 500 chars). Never paste whole conversations. Skips duplicates.",
    inputSchema: { type: "object", properties: { text: { type: "string" }, tags: { type: "string" } }, required: ["text"] } },
  { name: "search", description: "Find memories containing all the query words (max 20 short results). Use before answering questions about the user.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer" } }, required: ["query"] } },
  { name: "recent", description: "Show the most recent memories (max 20). Use only when the user asks what was saved recently.",
    inputSchema: { type: "object", properties: { n: { type: "integer" } } } },
  { name: "update_memory", description: "Change an existing memory by id. Pass only the fields to change. The old text is kept in history.",
    inputSchema: { type: "object", properties: { memory_id: { type: "string" }, text: { type: "string" }, tags: { type: "string" } }, required: ["memory_id"] } },
  { name: "forget", description: "Delete one memory by id.",
    inputSchema: { type: "object", properties: { memory_id: { type: "string" } }, required: ["memory_id"] } },
  { name: "get_skill_template", description: "Returns the required SKILL.md template (max 5000 tokens per skill). Call before upload_skill.",
    inputSchema: { type: "object", properties: {} } },
  { name: "upload_skill", description: "Upload a new skill as SKILL.md text using the template from get_skill_template. It is saved as pending and used only after the owner approves it. Max 5000 tokens.",
    inputSchema: { type: "object", properties: { skill_md: { type: "string" } }, required: ["skill_md"] } },
  { name: "select_skills", description: "Call FIRST, before any task. Send the user's request word for word and the files you plan to edit. Returns only the skill instructions to follow (or none).",
    inputSchema: { type: "object", properties: { request: { type: "string" }, files: { type: "array", items: { type: "string" } }, functions: { type: "array", items: { type: "string" } } }, required: ["request"] } },
  { name: "housekeep", description: "Ask Gemini to find duplicate or conflicting memories. Dry run unless apply=true. Only apply after the user approves.",
    inputSchema: { type: "object", properties: { apply: { type: "boolean" } } } }
];
