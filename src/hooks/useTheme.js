import { useEffect } from "react";
import { usePersistent } from "./usePersistent.js";

// mode: "system" | "light" | "dark". Sets data-theme on <html>; CSS does the rest.
export function useTheme() {
  const [mode, setMode] = usePersistent("relay.theme", "system");
  useEffect(() => {
    const root = document.documentElement;
    if (mode === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", mode);
    const dark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    // With an explicit choice, every theme-color tag must follow it (the media-specific ones would win otherwise).
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      if (!m.hasAttribute("data-media")) { m.setAttribute("data-media", m.getAttribute("media") || ""); m.setAttribute("data-content", m.content); }
      if (mode === "system") {
        const med = m.getAttribute("data-media");
        if (med) m.setAttribute("media", med);
        m.content = m.getAttribute("data-content");
      } else { m.removeAttribute("media"); m.content = dark ? "#13161E" : "#F5F1EA"; }
    });
  }, [mode]);
  return [mode, setMode];
}
