// Calls to AI providers with an IDLE watchdog instead of a flat timeout.
// A request is only stopped when nothing arrives for too long:
//   firstMs  how long the model may think before its answer starts (headers or first chunk)
//   idleMs   the longest silence allowed between two chunks once the answer is streaming
//   totalMs  a safety cap against a stream that never ends
// Every chunk that arrives restarts the idle clock, so a model that is producing output is never cut off.
export const AI_FAST = { firstMs: 60000, idleMs: 30000, totalMs: 120000, deadlineMs: 150000 };   // picks, housekeeping
export const AI_LONG = { firstMs: 180000, idleMs: 90000, totalMs: 420000, deadlineMs: 450000 };  // Skill Studio (long answers, thinking models)

export async function fetchIdle(url, init, t = AI_FAST) {
  const ctl = new AbortController();
  let timer = null, why = "";
  const stop = (reason) => { why = reason; ctl.abort(); };
  const arm = (ms, reason) => { clearTimeout(timer); timer = setTimeout(() => stop(reason), ms); };
  // Rejects the moment the watchdog fires, even if the underlying stream ignores the abort signal.
  const aborted = new Promise((_, rej) => ctl.signal.addEventListener("abort", () => rej(new Error("aborted")), { once: true }));
  aborted.catch(() => {});
  const cap = setTimeout(() => stop("the overall time limit was reached"), t.totalMs);
  arm(t.firstMs, "the model sent nothing for " + Math.round(t.firstMs / 1000) + "s");
  try {
    const res = await Promise.race([fetch(url, { ...init, signal: ctl.signal }), aborted]);
    const idle = "the answer stalled for " + Math.round(t.idleMs / 1000) + "s";
    arm(t.idleMs, idle);
    let text = "";
    if (res.body && res.body.getReader) {
      const rd = res.body.getReader(), dec = new TextDecoder();
      for (;;) {
        const { done, value } = await Promise.race([rd.read(), aborted]);
        if (done) break;
        text += dec.decode(value, { stream: true });
        arm(t.idleMs, idle); // output is flowing: restart the idle clock
      }
      text += dec.decode();
    } else {
      text = await Promise.race([res.text(), aborted]);
    }
    return new Response(text, { status: res.status });
  } catch (e) {
    throw new Error(why ? "stopped because " + why : String((e && e.message) || e));
  } finally {
    clearTimeout(timer); clearTimeout(cap);
  }
}

// Server-sent events: returns the JSON payload of every "data:" line.
export function sseEvents(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const d = line.slice(5).trim();
    if (!d || d === "[DONE]") continue;
    try { out.push(JSON.parse(d)); } catch { /* keep-alive or partial line */ }
  }
  return out;
}
export const isSse = (text) => /^\s*(data:|:)/.test(String(text));
