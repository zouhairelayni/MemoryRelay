import { useCallback, useState } from "react";
import { skills } from "../api/endpoints.js";

// The Skill Genie library: list, add (paste or .md file), switch on/off, core, delete, and a test run.
export function useSkills() {
  const [items, setItems] = useState([]);
  const [max, setMax] = useState(3);
  const [message, setMessage] = useState({ text: "", tone: "muted" });
  const [loaded, setLoaded] = useState(false);

  const say = (text, tone = "muted") => setMessage({ text, tone });

  const load = useCallback(async () => {
    try {
      const d = await skills.list();
      setItems(d.skills); setMax(d.settings.max);
    } catch (e) { say(e.message, "bad"); } finally { setLoaded(true); }
  }, []);

  const add = useCallback(async (text, source) => {
    try {
      const d = await skills.add(text, source);
      await load();
      const warn = d.warnings && d.warnings.length ? " Check before use: " + d.warnings.join("; ") + "." : "";
      say("Added " + d.name + "." + warn, d.warnings && d.warnings.length ? "bad" : "ok");
      return true;
    } catch (e) { say(e.message, "bad"); return false; }
  }, [load]);

  const toggle = useCallback(async (name, flag, value) => {
    try { await skills.setFlag(name, flag, value); await load(); } catch (e) { say(e.message, "bad"); }
  }, [load]);

  const remove = useCallback(async (name) => {
    try { await skills.remove(name); await load(); say("Deleted " + name + "."); } catch (e) { say(e.message, "bad"); }
  }, [load]);

  const saveMax = useCallback(async (n) => {
    try { const d = await skills.setMax(n); setMax(d.max); say("Up to " + d.max + " skills per request."); }
    catch (e) { say(e.message, "bad"); }
  }, []);

  return { items, max, message, loaded, load, add, toggle, remove, saveMax, say };
}
