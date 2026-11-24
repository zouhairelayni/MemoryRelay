import { useCallback, useState } from "react";
import { gemini } from "../api/endpoints.js";

// Gemini key and model pools (add, toggle, delete, reorder). Every op returns the new state.
export function useGemini({ onChange } = {}) {
  const [state, setState] = useState({ keys: [], models: [] });
  const [message, setMessage] = useState("");
  const [available, setAvailable] = useState([]);
  const [loadingAvailable, setLoadingAvailable] = useState(false);

  const load = useCallback(async () => {
    try { setState(await gemini.state()); } catch (e) { setMessage(e.message); }
  }, []);

  const op = useCallback(async (body) => {
    try {
      const s = await gemini.op(body);
      setState(s); setMessage("");
      if (onChange) onChange();
      return true;
    } catch (e) { setMessage(e.message); load(); return false; }
  }, [load, onChange]);

  const loadAvailable = useCallback(async () => {
    setLoadingAvailable(true); setMessage("Loading models from saved keys...");
    try {
      const list = await gemini.models();
      setAvailable(list);
      setMessage(list.length + " models available.");
    } catch (e) { setAvailable([]); setMessage(e.message); }
    finally { setLoadingAvailable(false); }
  }, []);

  return { ...state, message, available, loadingAvailable, load, op, loadAvailable };
}
