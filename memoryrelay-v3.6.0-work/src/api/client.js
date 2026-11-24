// The only place that calls fetch. Every other file goes through these helpers.
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Set by the auth hook: called when any request comes back 401 (session ended).
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export async function request(path, { method = "GET", body, raw = false } = {}) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError("Cannot reach the server. Check your connection.", 0);
  }
  if (raw) return res;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith("/auth/")) onUnauthorized();
  if (!res.ok) throw new ApiError(data.error || "Request failed (" + res.status + ")", res.status);
  return data;
}

export const get = (path) => request(path);
export const post = (path, body) => request(path, { method: "POST", body: body ?? {} });
export const put = (path, body) => request(path, { method: "PUT", body });
export const del = (path) => request(path, { method: "DELETE" });
