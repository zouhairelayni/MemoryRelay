import { useCallback, useState } from "react";
import { services } from "../api/endpoints.js";
import { copyText } from "../lib/clipboard.js";

// Connections (one MCP address per agent).
export function useServices({ onChange } = {}) {
  const [items, setItems] = useState([]);
  const [focusId, setFocusId] = useState(null);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (focus) => {
    try {
      const list = await services.list();
      setItems(list);
      if (focus) setFocusId(focus);
    } catch (e) {
      setMessage(e.message);
    } finally {
      setLoaded(true);
    }
  }, []);

  const done = useCallback(async (msg, focus) => {
    setMessage(msg);
    await load(focus);
    if (onChange) onChange();
  }, [load, onChange]);

  const create = useCallback(async (name, access = "write") => {
    const clean = name.trim();
    if (!clean) { setMessage("Type a name first."); return false; }
    try {
      const d = await services.create(clean, access);
      const addr = window.location.origin + d.url;
      const ok = await copyText(addr);
      await done("Added " + d.name + " (ID " + d.id + "). Address " + (ok ? "copied" : "shown below") + ": " + addr, d.id);
      return true;
    } catch (e) { setMessage(e.message); return false; }
  }, [done]);

  const revoke = useCallback(async (id) => {
    try { await services.revoke(id); await done("Revoked."); } catch (e) { setMessage(e.message); load(); }
  }, [done, load]);

  const remove = useCallback(async (id) => {
    try { await services.remove(id); await done("Deleted."); } catch (e) { setMessage(e.message); load(); }
  }, [done, load]);

  const setAccess = useCallback(async (id, access) => {
    try { await services.setAccess(id, access); await done("Access changed."); } catch (e) { setMessage(e.message); load(); }
  }, [done, load]);

  const signOut = useCallback(async (id) => {
    try { const d = await services.signOut(id); await done(d.signed_out ? "Signed out every OAuth session." : "No OAuth sessions were open."); }
    catch (e) { setMessage(e.message); }
  }, [done]);

  const copyAddress = useCallback(async (url) => {
    const ok = await copyText(window.location.origin + url);
    setMessage(ok ? "Address copied." : "Could not copy. Long-press the address to copy it manually.");
  }, []);

  return { items, loaded, message, focusId, load, create, revoke, remove, copyAddress, setAccess, signOut };
}
