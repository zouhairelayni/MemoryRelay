import Icon from "../components/Icon.jsx";
import Logo from "../components/Logo.jsx";

export default function TopBar({ onSettings }) {
  return (
    <header className="topbar">
      <div className="brand-mark">
        <Logo size={30} />
        <span className="brand">Memory Relay</span>
      </div>
      <button type="button" className="ib lg" id="open-settings" onClick={onSettings} aria-label="Open settings" title="Settings"><Icon name="gear" size={22} /></button>
    </header>
  );
}
