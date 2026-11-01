// Shared limits and the MCP tool list.

export const MAX_LEN = 500;
export const FALLBACK_MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"];
export const SESSION_DAYS = 14;
export const PBKDF2_ITER = 100000;
export const MAX_CALLS = 8; // Workers subrequest budget per request
export const RETRYABLE = new Set([0, 500, 502, 503, 504]); // 0 = could not reach Gemini at all
export const BUILD = "2026-10-24.2-oauth";
export const MAX_MEMORIES = 5000;        // library cap, stops a looping agent from filling the database
export const MAX_TAGS = 5;
export const MAX_ARG_CHARS = 100000;     // largest single string an agent may send
export const MCP_PER_MINUTE = 300;       // requests per connection
export const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const SERVER_VERSION = "3.1.0";
export const ACCESS = ["read", "write", "full"];   // what a connection may do
export const ACCESS_RANK = { read: 1, write: 2, full: 3 };
export const ACCESS_LABEL = { read: "Read only", write: "Read and write", full: "Full access" };
// The lowest access level that may call each tool.
export const TOOL_LEVEL = { search: "read", recent: "read", get_skill_template: "read", select_skills: "read", draft_skill: "read",
  remember: "write", update_memory: "write", upload_skill: "write", delegate: "write", get_delegation_brief: "read", forget: "full", housekeep: "full" };

const T = (title, o) => ({ title, readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, ...o });
export const TOOLS = [
  { name: "remember", annotations: T("Save a memory", { idempotentHint: true }),
    description: "Save ONE short, self-contained fact, preference, or decision (max 500 chars). Never paste whole conversations. Skips duplicates.",
    inputSchema: { type: "object", properties: { text: { type: "string" }, tags: { type: "string" } }, required: ["text"] } },
  { name: "search", annotations: T("Search memories", { readOnlyHint: true, idempotentHint: true }),
    description: "Find memories containing all the query words (max 20 short results). Use before answering questions about the user.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer" } }, required: ["query"] } },
  { name: "recent", annotations: T("Recent memories", { readOnlyHint: true, idempotentHint: true }),
    description: "Show the most recent memories (max 20). Use only when the user asks what was saved recently.",
    inputSchema: { type: "object", properties: { n: { type: "integer" } } } },
  { name: "update_memory", annotations: T("Update a memory", { destructiveHint: true, idempotentHint: true }),
    description: "Change an existing memory by id. Pass only the fields to change. The old text is kept in history.",
    inputSchema: { type: "object", properties: { memory_id: { type: "string" }, text: { type: "string" }, tags: { type: "string" } }, required: ["memory_id"] } },
  { name: "forget", annotations: T("Delete a memory", { destructiveHint: true, idempotentHint: true }),
    description: "Delete one memory by id.",
    inputSchema: { type: "object", properties: { memory_id: { type: "string" } }, required: ["memory_id"] } },
  { name: "get_skill_template", annotations: T("Skill template", { readOnlyHint: true, idempotentHint: true }),
    description: "Returns the required SKILL.md template (max 5000 tokens per skill). Call before upload_skill.",
    inputSchema: { type: "object", properties: {} } },
  { name: "draft_skill", annotations: T("Draft a skill with AI", { readOnlyHint: true, openWorldHint: true }),
    description: "Ask the built-in AI to write a valid SKILL.md from a goal. Nothing is saved: review the draft, then call upload_skill. Limited to 10 per hour.",
    inputSchema: { type: "object", properties: { goal: { type: "string" }, details: { type: "string" } }, required: ["goal"] } },
  { name: "upload_skill", annotations: T("Upload a skill", {}),
    description: "Upload a new skill as SKILL.md text using the template from get_skill_template. It is saved as pending and used only after the owner approves it. Max 5000 tokens.",
    inputSchema: { type: "object", properties: { skill_md: { type: "string" } }, required: ["skill_md"] } },
  { name: "get_delegation_brief", annotations: T("Delegation guide and brief form", { readOnlyHint: true, idempotentHint: true }),
    description: "Returns the guide for delegating work to sub-agents and the brief form to fill in. Read it once before your first delegate call.",
    inputSchema: { type: "object", properties: {} } },
  { name: "delegate", annotations: T("Hand a job to a sub-agent", { openWorldHint: true }),
    description: "Hand ONE self-contained job (snippet, function, small feature, tests, refactor, review, debug, explanation) to another AI model and get the result back. It saves your own usage limits. Fill the brief: task, kind, language, interface, requirements, constraints, acceptance, context (max 7900 tokens in total, no secrets). The sub-agent has no tools, files or web. The reply ends with a quality report; you must still check the result against your acceptance list and run the tests. Use verify=true for features and risky code. Call get_delegation_brief for the guide.",
    inputSchema: { type: "object", properties: {
      task: { type: "string" }, kind: { type: "string", enum: ["snippet", "function", "feature", "refactor", "tests", "review", "explain", "debug", "other"] },
      language: { type: "string" }, interface: { type: "string" }, requirements: { type: "string" }, constraints: { type: "string" },
      acceptance: { type: "string" }, context: { type: "string" }, verify: { type: "boolean" },
      provider: { type: "string", enum: ["gemini", "openrouter", "nvidia", "openai"] }, model: { type: "string" }, max_output_tokens: { type: "integer" } }, required: ["task"] } },
  { name: "select_skills", annotations: T("Pick skills for a request", { readOnlyHint: true, openWorldHint: true }),
    description: "Call FIRST, before any task. Send the user's request word for word and the files you plan to edit. Returns only the skill instructions to follow (or none).",
    inputSchema: { type: "object", properties: { request: { type: "string" }, files: { type: "array", items: { type: "string" } }, functions: { type: "array", items: { type: "string" } } }, required: ["request"] } },
  { name: "housekeep", annotations: T("Find duplicate memories", { destructiveHint: true, openWorldHint: true }),
    description: "Find duplicate or conflicting memories with AI. Without apply it only proposes and returns a proposal_id. To apply, show the proposal to the user, and after they approve call again with apply=true and that proposal_id (valid 10 minutes).",
    inputSchema: { type: "object", properties: { apply: { type: "boolean" }, proposal_id: { type: "string" } } } },
];
