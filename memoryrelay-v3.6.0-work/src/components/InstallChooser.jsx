import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useInstallPrompt } from "../hooks/useInstallPrompt.js";
import { useAccent, ACCENTS } from "../hooks/useAccent.js";
import AccentPicker from "./AccentPicker.jsx";
import Icon from "./Icon.jsx";

const PENDING = "relay.pendingInstall";
export default function InstallChooser({ variant = "button" }) {
  const install = useInstallPrompt();
  const [accent, setAccent] = useAccent();
  const [open, setOpen] = useState(() => window.sessionStorage.getItem(PENDING) === "ready");
  const [choice, setChoice] = useState(accent);
  const [message, setMessage] = useState("");
  useEffect(() => { if (open) setChoice(accent); }, [open, accent]);
  const close = () => { setOpen(false); window.sessionStorage.removeItem(PENDING); };
  const prepare = async () => {
    if (choice !== accent) {
      setAccent(choice);
      // Chromium installs the manifest that existed when beforeinstallprompt fired.
      // A reload is necessary to guarantee the chosen icon in a new installation.
      window.sessionStorage.setItem(PENDING, "ready");
      window.location.reload();
      return;
    }
    if (install.canInstall) {
      await install.install();
      close();
    } else {
      setMessage("Theme selected. Use your browser menu → Install app. If you already installed MemoryRelay, reinstall it to replace the Android launcher icon.");
    }
  };
  if (install.installed) return variant === "section" ? <p className="muted small">Installed as MemoryRelay. Accent changes update the app; Android may need a reinstall to update its launcher icon.</p> : null;
  return <>
    <button type="button" className={variant === "section" ? "btn" : "btn sm"} onClick={() => { setMessage("");setOpen(true); }}>
      <Icon name="phone" size={16}/> Install MemoryRelay
    </button>
    {open ? createPortal(<div className="install-picker-overlay" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <section className="install-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="install-picker-title" aria-describedby="install-picker-help">
        <header><div><span className="dash-eyebrow">YOUR LAUNCHER ICON</span><h2 id="install-picker-title">Choose your accent</h2></div>
          <button type="button" className="icon-close" title="Close" aria-label="Close install theme picker" onClick={close}><Icon name="x"/></button></header>
        <p id="install-picker-help">Choose the color for your MemoryRelay PWA before installing. You can change the in-app accent later in Settings.</p>
        <AccentPicker label="Choose installed app accent" value={choice} onChange={setChoice}/>
        <p className="install-picker-note" role="status">{message || (choice !== accent ? "Your app will reload once to prepare this icon. Then tap Install." : `Ready: ${ACCENTS.find(a=>a.id===choice)?.name} icon.`)}</p>
        <div className="install-picker-actions"><button type="button" className="btn ghost" onClick={close}>Cancel</button>
          <button type="button" className="btn" onClick={prepare}>{choice !== accent ? "Prepare icon" : install.canInstall ? "Install MemoryRelay" : "Use this icon"}</button></div>
      </section>
    </div>, document.body) : null}
  </>;
}
