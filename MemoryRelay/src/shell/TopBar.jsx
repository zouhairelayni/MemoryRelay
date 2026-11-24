import Icon from "../components/Icon.jsx";
import Logo from "../components/Logo.jsx";
import PwaRefresh from "./PwaRefresh.jsx";

const HEADERS = {
  memory: ["Memories", "Your searchable knowledge library"],
  skills: ["Skills", "Discover, sync and manage skills"],
  agents: ["Connections", "Manage access for connected agents"],
  keys: ["Models", "AI providers and subagent routing"],
};

export default function TopBar({ onSettings, tabId = "home" }) {
  const heading = HEADERS[tabId];
  return <header className="topbar">
    {heading ? <div className="topbar-page" aria-label={`${heading[0]}. ${heading[1]}`}>
      <h1>{heading[0]}</h1><span>{heading[1]}</span>
    </div> : <div className="brand-mark">
      <Logo size={36} animated />
      <span className="brand">Memory Relay</span>
    </div>}
    <PwaRefresh />
    <button type="button" className="ib lg" id="open-settings" onClick={onSettings} aria-label="Open settings" title="Settings"><Icon name="gear" size={22} /></button>
  </header>;
}
