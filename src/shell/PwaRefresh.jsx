import { useEffect, useState } from "react";
import Icon from "../components/Icon.jsx";

function isStandalone() {
  return (typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches)
    || (typeof navigator !== "undefined" && navigator.standalone === true);
}
export default function PwaRefresh() {
  const [installed, setInstalled] = useState(isStandalone);
  useEffect(() => {
    const display = window.matchMedia("(display-mode: standalone)");
    const sync = () => setInstalled(isStandalone());
    display.addEventListener?.("change", sync);
    window.addEventListener("pageshow", sync);
    return () => { display.removeEventListener?.("change", sync); window.removeEventListener("pageshow", sync); };
  }, []);
  if (!installed) return null;
  return <button type="button" className="pwa-refresh" aria-label="Refresh installed app" title="Refresh app"
    onClick={() => window.location.reload()}><Icon name="refresh" size={21}/></button>;
}
