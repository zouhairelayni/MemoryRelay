import { useCallback, useEffect, useState } from "react";

// Captures the browser's install prompt (Chrome, Edge, Samsung Internet). Brave on Android cannot
// install a real app, only a shortcut, so we report that too.
export function useInstallPrompt() {
  const [evt, setEvt] = useState(null);
  const [installed, setInstalled] = useState(() => window.matchMedia("(display-mode: standalone)").matches);

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setEvt(e); };
    const onInstalled = () => { setInstalled(true); setEvt(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!evt) return;
    evt.prompt();
    await evt.userChoice.catch(() => {});
    setEvt(null);
  }, [evt]);

  const brave = !!(navigator.brave && /Android/i.test(navigator.userAgent));
  return { canInstall: !!evt, installed, brave, install };
}
