import { useApp } from "../shell/AppContext.js";
import { useAccent } from "../hooks/useAccent.js";
import AccentPicker from "../components/AccentPicker.jsx";
import Segmented from "../components/Segmented.jsx";
import Section from "./Section.jsx";

export default function Appearance() {
  const { theme, setTheme } = useApp();
  const [accent, setAccent] = useAccent();
  return <Section title="Appearance">
    <div className="appearance-stack">
      <div className="settings-setting-title">Color mode</div>
      <Segmented label="Theme" value={theme} onChange={setTheme} options={[
        { value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" },
      ]} />
      <div className="settings-setting-title">Accent & icon</div>
      <p className="muted small">Choose your app colors. Each accent has its own matching logo.</p>
      <AccentPicker value={accent} onChange={setAccent}/>
      <p className="muted small" role="note">Your in-app icon changes immediately. Android may keep the installed launcher icon until you reinstall the PWA.</p>
    </div>
  </Section>;
}
