// Shared limits and the MCP tool list.

export const FALLBACK_MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"];
export const SESSION_DAYS = 14;
export const PBKDF2_ITER = 100000;
export const MAX_CALLS = 8; // Workers subrequest budget per request
export const RETRYABLE = new Set([0, 500, 502, 503, 504]); // 0 = could not reach Gemini at all
export const BUILD = "2026-11-23.4-premium-accessible-interface";
export const MAX_MEMORIES = 5000;        // library cap, stops a looping agent from filling the database
export const MAX_TAGS = 5;
export const MAX_ARG_CHARS = 100000;     // largest single string an agent may send
export const MCP_PER_MINUTE = 300;       // requests per connection
export const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const SERVER_VERSION = "3.5.1";
export const ACCESS = ["read", "write", "full"];   // what a connection may do
export const ACCESS_RANK = { read: 1, write: 2, full: 3 };
export const ACCESS_LABEL = { read: "Read only", write: "Read and write", full: "Full access" };
// The lowest access level that may call each tool.
export const TOOL_LEVEL = { get_memory_settings: "read", search: "read", list_memories: "read", get_memory: "read", recent: "read", get_skill_template: "read", select_skills: "read", get_skill: "read", list_skills: "read", draft_skill: "read",
  get_skill_script: "read", get_skill_resource: "read", remember: "write", update_memory: "write", upload_skill: "write", delegate: "write", get_delegation_brief: "read", forget: "full", housekeep: "full" };

const T = (title, o) => ({ title, readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, ...o });
export const TOOLS = [
  { name: "get_memory_settings", annotations: T("Current memory context limit", { readOnlyHint: true, idempotentHint: true }),
    description: "Read the current owner-configured per-memory estimated-token limit. Changes in dashboard Settings apply instantly to MCP storage and search.",
    inputSchema: { type: "object", properties: {} } },
  // Typed labels and memory descriptions are independent from the original context tags.
  // Clients can discover every memory without sending entire Markdown bodies to the model.
  { name: "remember", annotations: T("Save Markdown memory", { idempotentHint: true }),
    description: "Save ONE durable memory. Supply a brief searchable description and optional structured metadata. Format text in Markdown: **bold title**, - *italic labels:* details, `inline commands`, and ```bash fenced code blocks (copyable in owner UI). context tags remain separate from colored app/platform/feature/version/language/stack labels. No secrets or whole chats. Server enforces owner's live estimated-token limit.",
    inputSchema: { type: "object", properties: {
      text: { type: "string", description: "Full Markdown content; headings, lists, fenced snippets and terminal commands are preserved as text, never executed." },
      description: { type: "string", description: "Short, factual search description (max 280 characters); if omitted, the index displays the first existing title/line." },
      tags: { type: "string", description: "Legacy context tags, comma separated, max 5; 'rules' is owner-only. Independent of metadata." },
      metadata: { type: "object", description: "Editable typed labels. Use only verifiable values; never guess missing build/release versions.", properties: {
        app: { type: "string", description: "Product/project name, e.g. RIVNA" },
        platforms: { type: "array", items: { type: "string" }, description: "Platforms: pwa, web, android, ios, backend etc." },
        feature: { type: "string", description: "Feature name" },
        version: { type: "string", description: "Verified release/build version, e.g. BUILD 09 or v3.5.0" },
        languages: { type: "array", items: { type: "string" }, description: "Programming languages, e.g. JavaScript, Python" },
        stack: { type: "array", items: { type: "string" }, description: "Technology stack, e.g. React, Cloudflare Workers, D1" },
      }, additionalProperties: false },
    }, required: ["text"] } },
  { name: "search", annotations: T("Search full memory library", { readOnlyHint: true, idempotentHint: true }),
    description: "Search the ENTIRE memory library across Markdown, description, context tags and typed labels. Returns short index entries (ID, description, metadata, tags), NOT full text. Page with offset=next_offset until null; max 100 per page. Call get_memory(memory_id) to read selected full Markdown, fenced snippets and commands. Filter by app, platform, feature, version, language or stack. Compatibility for old connector registrations: query=@page:100_keywords retrieves an offset page; query=@read:memoryid retrieves the entire selected memory, until get_memory becomes available after reconnecting.",
    inputSchema: { type: "object", properties: {
      query: { type: "string", description: "Keywords; all words must match. Empty query lists every memory." },
      limit: { type: "integer", description: "Index results per page, 1–100 (default 20)." },
      offset: { type: "integer", description: "Zero-based offset; advance using next_offset." },
      app: { type: "string" }, platforms: { type: "string", description: "One platform e.g. pwa" },
      feature: { type: "string" }, version: { type: "string" },
      languages: { type: "string", description: "One language" }, stack: { type: "string", description: "One stack technology" },
    }, required: ["query"] } },
  { name: "list_memories", annotations: T("Browse all memory descriptions", { readOnlyHint: true, idempotentHint: true }),
    description: "Page through ALL saved memories by short description without loading full content. Optional keyword/typed-label filters. Returns total, next_offset and index entries with colored-label metadata. Use get_memory with an ID to read full Markdown and copyable commands. Always follow next_offset until null when an exhaustive listing is needed.",
    inputSchema: { type: "object", properties: {
      query: { type: "string" }, limit: { type: "integer" }, offset: { type: "integer" },
      app: { type: "string" }, platforms: { type: "string" }, feature: { type: "string" },
      version: { type: "string" }, languages: { type: "string" }, stack: { type: "string" },
    } } },
  { name: "get_memory", annotations: T("Read one complete memory", { readOnlyHint: true, idempotentHint: true }),
    description: "Retrieve ONE full memory by ID after search/list_memories. Returns the complete Markdown text with bold/italic titles, bullets, code snippets and copyable commands, plus description, legacy context tags and typed metadata (app, platforms, feature, version, languages, stack). Does not execute commands.",
    inputSchema: { type: "object", properties: { memory_id: { type: "string" } }, required: ["memory_id"] } },
  { name: "recent", annotations: T("Recently saved memory text", { readOnlyHint: true, idempotentHint: true }),
    description: "Show up to 20 recent full Markdown memories. For exhaustive discovery use list_memories or search with offset/next_offset, then get_memory by ID.",
    inputSchema: { type: "object", properties: { n: { type: "integer" } } } },
  { name: "update_memory", annotations: T("Edit Markdown memory and labels", { destructiveHint: true, idempotentHint: true }),
    description: "Edit a memory by ID: Markdown text, searchable short description, legacy context tags, or independently editable structured labels. Preserve titles, lists, inline snippets and ```bash commands. metadata patch updates specified keys; pass empty values/arrays to clear labels. Existing text history remains. Rules cannot be modified via MCP.",
    inputSchema: { type: "object", properties: {
      memory_id: { type: "string" }, text: { type: "string", description: "Full Markdown, optional; owner-configured estimated token limit applies" },
      description: { type: "string", description: "Short description (max 280 chars); empty string clears override" },
      tags: { type: "string", description: "Context tags; separate from colored metadata; blank clears context tags" },
      metadata: { type: "object", description: "Partial replacement of typed labels; supplied keys only. Fields: app, platforms[], feature, version, languages[], stack[].", properties: {
        app: { type: "string" }, platforms: { type: "array", items: { type: "string" } }, feature: { type: "string" },
        version: { type: "string" }, languages: { type: "array", items: { type: "string" } }, stack: { type: "array", items: { type: "string" } },
      }, additionalProperties: false },
    }, required: ["memory_id"] } },
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
  { name: "get_skill_script", annotations: T("Fetch a Python skill script", { readOnlyHint: true, idempotentHint: true }),
    description: "Fetch a source-only Python script template from MemoryRelay's script bank. Scripts are included automatically when the matching skill is selected; they are never executed by the server.",
    inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "get_skill_resource", annotations: T("Fetch a file that ships with a skill", { readOnlyHint: true, idempotentHint: true }),
    description: "Fetch a file that ships with a skill (script, test, font or reference), exactly as in its repository. Without path it lists all files of the skill. Large files and fonts (base64) come in parts: repeat with offset=next_offset until done. Never executes the file.",
    inputSchema: { type: "object", properties: { skill: { type: "string" }, path: { type: "string" }, offset: { type: "integer" }, limit: { type: "integer" } }, required: ["skill"] } },
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
    description: "Call FIRST, before any task. Send the user's request word for word and the files you plan to edit. Returns up to 10 relevant skills (owner-adjustable in Settings) with instructions to follow, or none.",
    inputSchema: { type: "object", properties: { request: { type: "string" }, files: { type: "array", items: { type: "string" } }, functions: { type: "array", items: { type: "string" } } }, required: ["request"] } },
  { name: "get_skill", annotations: T("Get one skill by name", { readOnlyHint: true, idempotentHint: true }),
    description: "Fetch one skill by its exact name (for example when the user says \"use ponytail-audit\"). Returns its instructions, or says why it cannot (unknown name with similar names, or switched off by the owner).",
    inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "list_skills", annotations: T("List available skills", { readOnlyHint: true, idempotentHint: true }),
    description: "List the enabled skills (name and one-line description). Optional query narrows it. Use it to check whether a skill exists before saying it does not.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer" } } } },
  { name: "housekeep", annotations: T("Find duplicate memories", { destructiveHint: true, openWorldHint: true }),
    description: "Preview duplicate/conflicting memories with AI. Merging or deleting memories requires explicit confirmation in the authenticated owner dashboard; MCP calls cannot apply proposals.",
    inputSchema: { type: "object", properties: { apply: { type: "boolean" }, proposal_id: { type: "string" } } } },
];
