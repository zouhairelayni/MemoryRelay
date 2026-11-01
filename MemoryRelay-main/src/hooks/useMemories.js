import { useCallback, useState } from "react";
import { housekeeping, memories } from "../api/endpoints.js";

export function useMemories({ onChange } = {}) {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (q = "") => {
    try { setItems(await memories.list(q)); setError(""); } catch (e) { setError(e.message); } finally { setLoaded(true); }
  }, []);

  const after = useCallback(async (q) => { await load(q); if (onChange) onChange(); }, [load, onChange]);

  const add = useCallback(async (body, q) => { await memories.add(body); await after(q); }, [after]);
  const edit = useCallback(async (id, body, q) => { await memories.edit(id, body); await after(q); }, [after]);
  const remove = useCallback(async (id, q) => {
    try { await memories.remove(id); await after(q); } catch (e) { setError(e.message); }
  }, [after]);

  return { items, error, loaded, load, add, edit, remove };
}

// Duplicate cleanup: check (dry run) then apply exactly what the owner saw.
export function useHousekeeping({ onApplied, onUsedGemini } = {}) {
  const [phase, setPhase] = useState("idle"); // idle | checking | proposed | applying | done | error
  const [groups, setGroups] = useState([]);
  const [text, setText] = useState("");

  const check = useCallback(async () => {
    setPhase("checking"); setGroups([]); setText("");
    try {
      const d = await housekeeping.check();
      if (onUsedGemini) onUsedGemini();
      if (d.error) { setText(d.error); setPhase("error"); return; }
      if (!d.proposed || !d.proposed.length) { setText(d.message || "No duplicates found."); setPhase("done"); return; }
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
      setPhase("done");
      if (onApplied) onApplied();
    } catch (e) { setText(e.message); setPhase("error"); }
  }, [groups, onApplied]);

  const cancel = useCallback(() => { setGroups([]); setText(""); setPhase("idle"); }, []);
  return { phase, groups, text, check, apply, cancel };
}
