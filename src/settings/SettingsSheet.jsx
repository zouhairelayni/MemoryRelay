import Sheet from "../components/Sheet.jsx";
import Account from "./Account.jsx";
import Appearance from "./Appearance.jsx";
import Gestures from "./Gestures.jsx";
import Install from "./Install.jsx";
import Backup from "./Backup.jsx";
import About from "./About.jsx";

// Add a new settings section: create a component and list it here.
export default function SettingsSheet({ open, onClose }) {
  return (
    <Sheet open={open} title="Settings" onClose={onClose}>
      <Account />
      <Appearance />
      <Gestures />
      <Install />
      <Backup />
      <About />
    </Sheet>
  );
}
