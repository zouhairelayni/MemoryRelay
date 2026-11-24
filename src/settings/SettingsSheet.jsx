import Sheet from "../components/Sheet.jsx";
import Account from "./Account.jsx";
import Appearance from "./Appearance.jsx";
import Gestures from "./Gestures.jsx";
import Install from "./Install.jsx";
import Backup from "./Backup.jsx";
import MemoryContext from "./MemoryContext.jsx";
import About from "./About.jsx";
import { useApp } from "../shell/AppContext.js";
import Button from "../components/Button.jsx";

// Add a new settings section: create a component and list it here.
export default function SettingsSheet({ open, onClose }) {
  const { go } = useApp();
  return (
    <Sheet open={open} title="Settings" onClose={onClose}>
      <div className="settings-intro"><span className="dash-eyebrow">WORKSPACE PREFERENCES</span><h3>Make it yours.</h3><p>Manage access, appearance and data in one place.</p></div>
      <div className="settings-group" aria-label="Personalize"><span className="settings-group-label">Personalize</span><Appearance /><Gestures /></div>
      <div className="settings-group" aria-label="Memory and data"><span className="settings-group-label">Memory and data</span><MemoryContext /><Backup /></div>
      <div className="settings-group" aria-label="Workspace and account"><span className="settings-group-label">Workspace and account</span><Button small variant="ghost" icon="alert" onClick={()=>go("errors")}>Open error diagnostics</Button><Account /><Install /><About /></div>
    </Sheet>
  );
}
