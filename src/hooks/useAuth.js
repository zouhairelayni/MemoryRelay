import { useCallback, useEffect, useState } from "react";
import { auth } from "../api/endpoints.js";
import { setUnauthorizedHandler } from "../api/client.js";

// phase: "loading" | "gate" | "app"
export function useAuth() {
  const [state, setState] = useState({ phase: "loading", setup: false, tokenRequired: false, email: "" });

  const refresh = useCallback(async () => {
    try {
      const s = await auth.status();
      setState({ phase: s.loggedIn ? "app" : "gate", setup: s.setup, tokenRequired: !!s.setup_token, email: s.email || "" });
    } catch {
      setState({ phase: "gate", setup: false, tokenRequired: false, email: "" });
    }
  }, []);

  useEffect(() => {
    refresh();
    setUnauthorizedHandler(() => setState((s) => (s.phase === "app" ? { ...s, phase: "gate" } : s)));
  }, [refresh]);

  const submit = useCallback(async (email, password, token) => {
    await (state.setup ? auth.setup(email, password, token) : auth.login(email, password));
    await refresh();
  }, [state.setup, refresh]);

  const logout = useCallback(async () => {
    await auth.logout().catch(() => {});
    await refresh();
  }, [refresh]);

  return { ...state, submit, logout };
}
