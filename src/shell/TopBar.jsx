import Icon from "../components/Icon.jsx";
import Logo from "../components/Logo.jsx";

export default function TopBar({ live, onSettings }) {
  const tone = live === null ? "" : live ? "ok" : "bad";
  return (
    <header className="topbar">
      <div className="brand-mark">
        <Logo size={30} />
        <span className="brand">Memory Relay</span>
      </div>
      <span className={"pulse " + tone} title={live === null ? "Checking" : live ? "Live" : "Not responding"} />
      <button type="button" className="ib lg" id="open-settings" onClick={onSettings} aria-label="Open settings" title="Settings"><Icon name="gear" size={20} /></button>
    </header>
  );
}
