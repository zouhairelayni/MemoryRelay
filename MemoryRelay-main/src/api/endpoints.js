// One function per server route. Components and hooks never build URLs themselves.
import { del, get, post, put, request } from "./client.js";

export const auth = {
  status: () => get("/auth/status"),
  login: (email, password) => post("/auth/login", { email, password }),
  setup: (email, password, setup_token) => post("/auth/setup", { email, password, setup_token }),
  logout: () => post("/auth/logout"),
};

export const overview = {
  settings: () => get("/api/settings"),
  test: () => post("/api/connector/test"),
  build: () => get("/api/build"),
};

export const services = {
  list: () => get("/api/services").then((d) => d.services),
  create: (name, access) => post("/api/services", { name, access }),
  setAccess: (id, access) => put("/api/services/" + id + "/access", { access }),
  signOut: (id) => post("/api/services/" + id + "/sessions/revoke"),
  revoke: (id) => post("/api/services/" + id + "/revoke"),
  remove: (id) => del("/api/services/" + id),
};

export const memories = {
  list: (q = "") => get("/api/memories?q=" + encodeURIComponent(q)).then((d) => d.items),
  add: (body) => post("/api/memories", body),
  edit: (id, body) => put("/api/memories/" + id, body),
  remove: (id) => del("/api/memories/" + id),
};

export const housekeeping = {
  check: () => post("/api/housekeep", { apply: false }),
  apply: (groups) => post("/api/housekeep", { apply: true, groups }),
};

export const gemini = {
  state: () => get("/api/gemini"),
  op: (body) => post("/api/gemini", body),
  models: () => get("/api/gemini/models").then((d) => d.models),
};

export const backup = {
  exportJson: async () => {
    const res = await request("/api/export", { raw: true });
    if (!res.ok) throw new Error("Export failed (" + res.status + ")");
    return res.blob();
  },
  importJson: async (text, mode) => {
    const res = await request("/api/import?mode=" + mode, { method: "POST", body: text, raw: true });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || d.error) throw new Error(d.error || "Import failed (" + res.status + ")");
    return d;
  },
};

export const skills = {
  list: () => get("/api/skills"),
  add: (text, source = "paste") => post("/api/skills", { text, source }),
  setFlag: (name, flag, value) => put("/api/skills/" + encodeURIComponent(name) + "/" + flag, { value }),
  remove: (name) => del("/api/skills/" + encodeURIComponent(name)),
  setMax: (max) => put("/api/skills/max", { max }),
  try: (request) => post("/api/skills/try", { request }),
  get: (name) => get("/api/skills/" + encodeURIComponent(name)),
  update: (name, text) => put("/api/skills/" + encodeURIComponent(name), { text }),
  revert: (name) => post("/api/skills/" + encodeURIComponent(name) + "/revert"),
  generate: (goal) => post("/api/skills/generate", { goal }),
  improve: (text, instruction) => post("/api/skills/improve", { text, instruction }),
};

// OpenRouter, NVIDIA and OpenAI share one set of routes: /api/<id> and /api/<id>/models.
export const provider = (id) => ({
  state: () => get("/api/" + id),
  op: (body) => post("/api/" + id, body),
  models: () => get("/api/" + id + "/models").then((d) => d.models),
});

// Sub-agents: switch, hourly limit, routing, usage.
export const delegation = {
  get: () => get("/api/delegation"),
  save: (patch) => put("/api/delegation", patch),
  guide: () => get("/api/delegation/guide").then((d) => d.guide),
  tryIt: (body) => post("/api/delegation/try", body),
};
