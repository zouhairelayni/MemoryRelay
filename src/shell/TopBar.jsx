import Icon from "../components/Icon.jsx";

export default function TopBar({ title, live, onSettings }) {
  const tone = live === null ? "" : live ? "ok" : "bad";
  return (
    <header className="topbar">
      <div className="brand-mark">
        <span className={"pulse " + tone} title={live === null ? "Checking" : live ? "Live" : "Not responding"} />
        <span className="brand">Memory Relay</span>
      </div>
      <span className="top-title" id="top-title">{title}</span>
      <button type="button" className="icon-btn" id="open-settings" onClick={onSettings} aria-label="Open settings"><Icon name="gear" /></button>
    </header>
  );
}
