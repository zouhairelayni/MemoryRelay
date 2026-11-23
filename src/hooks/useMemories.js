import { useCallback, useRef, useState } from "react";
import { housekeeping, memories } from "../api/endpoints.js";

export function useMemories({ onChange } = {}) {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [nextOffset, setNextOffset] = useState(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);
  const last = useRef({ q: "", rule: "all" });

  const load = useCallback(async (q = "", rule = "all") => {
    const current = ++revision.current;
    last.current = { q, rule };
    setBusy(true);
    try {
      const page = await memories.page({ q, rule, limit: 30, offset: 0 });
      if (current !== revision.current) return;
      setItems(page.items); setNextOffset(page.next_offset); setTotal(page.total); setError("");
    } catch (e) { if (current === revision.current) setError(e.message); }
    finally { if (current === revision.current) { setLoaded(true); setBusy(false); } }
  }, []);

  const loadMore = useCallback(async () => {
    if (nextOffset === null || busy) return;
    const current = revision.current;
    setBusy(true);
    try {
      const page = await memories.page({ ...last.current, limit: 30, offset: nextOffset });
      if (current !== revision.current) return;
      setItems((previous) => {
        const seen = new Set(previous.map((m) => m.id));
        return [...previous, ...page.items.filter((m) => !seen.has(m.id))];
      });
      setTotal(page.total); setNextOffset(page.next_offset); setError("");
    } catch (e) { if (current === revision.current) setError(e.message); }
    finally { if (current === revision.current) setBusy(false); }
  }, [nextOffset, busy]);

  const after = useCallback(async () => { await load(last.current.q, last.current.rule); onChange?.(); }, [load, onChange]);
  const add = useCallback(async (body) => { await memories.add(body); await after(); }, [after]);
  const edit = useCallback(async (id, body) => { await memories.edit(id, body); await after(); }, [after]);
  const remove = useCallback(async (id) => {
    try { await memories.remove(id); await after(); } catch (e) { setError(e.message); }
  }, [after]);

  return { items, total, nextOffset, busy, error, loaded, load, loadMore, add, edit, remove };
}

// Duplicate cleanup: check (dry run) then apply exactly what the owner saw.
export function useHousekeeping({ onApplied, onUsedGemini } = {}) {
  const [phase, setPhase] = useState("idle");
  const [groups, setGroups] = useState([]);
  const [text, setText] = useState("");

  const check = useCallback(async () => {
    setPhase("checking"); setGroups([]); setText("");
    try {
      const d = await housekeeping.check();
      onUsedGemini?.();
      if (d.error) { setText(d.error); setPhase("error"); return; }
      if (!d.proposed?.length) { setText(d.message || "No duplicates found."); setPhase("done"); return; }
      setGroups(d.proposed); setPhase("proposed");
    } catch (e) { setText(e.message); setPhase("error"); }
  }, [onUsedGemini]);

  const apply = useCallback(async () => {
    setPhase("applying");
    try {
      const d = await housekeeping.apply(groups);
      setGroups([]);
      if (d.error) { setText(d.error); setPhase("error"); return; }
      setText("Fixed. Removed " + d.removed + " duplicate" + (d.removed === 1 ? "" : "s") + ".");
      setPhase("done"); onApplied?.();
    } catch (e) { setText(e.message); setPhase("error"); }
  }, [groups, onApplied]);

  const cancel = useCallback(() => { setGroups([]); setText(""); setPhase("idle"); }, []);
  return { phase, groups, text, check, apply, cancel };
}
