import { useEffect, useState } from "react";
import Section from "./Section.jsx";
import Button from "../components/Button.jsx";
import { useApp } from "../shell/AppContext.js";
import { memorySettings } from "../api/endpoints.js";
import { DEFAULT_MEMORY_TOKENS, MIN_MEMORY_TOKENS, MAX_MEMORY_TOKENS } from "../../shared/memoryBudget.js";

export default function MemoryContext() {
  const { counts, loadCounts } = useApp();
  const current = counts.memory_max_tokens || DEFAULT_MEMORY_TOKENS;
  const [draft, setDraft] = useState(String(current));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  useEffect(() => { setDraft(String(current)); }, [current]);
  const number = Number(draft);
  const valid = draft.trim() !== "" && Number.isInteger(number) && number >= MIN_MEMORY_TOKENS && number <= MAX_MEMORY_TOKENS;
  async function save(e) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true); setStatus("");
    try {
      await memorySettings.set(number);
      await loadCounts();
      setStatus(`Saved: ${number} estimated tokens per memory. MCP uses this limit immediately.`);
    } catch (err) { setStatus(err.message || "Could not save."); }
    finally { setBusy(false); }
  }
  return <Section title="Memory context">
    <form className="stack" onSubmit={save}>
      <label className="small" htmlFor="memory-token-limit">Maximum estimated tokens per memory</label>
      <input id="memory-token-limit" className="fld" type="number" min={MIN_MEMORY_TOKENS} max={MAX_MEMORY_TOKENS}
        step="1" value={draft} onChange={e => setDraft(e.target.value)} disabled={busy}/>
      <p className="muted small">Default: 1,000. Choose {MIN_MEMORY_TOKENS.toLocaleString()}–{MAX_MEMORY_TOKENS.toLocaleString()}. Applies to rules, imports and MCP saves/updates without redeploying. Token counts are conservative estimates, not provider-exact.</p>
      <div className="row" style={{marginTop:0}}><Button type="submit" disabled={!valid || busy || number===current}>{busy ? "Saving…" : "Save limit"}</Button>
        <span className="muted small">Current: {current.toLocaleString()} estimated tokens</span></div>
      {status ? <p className="small" role="status">{status}</p> : null}
    </form>
  </Section>;
}
