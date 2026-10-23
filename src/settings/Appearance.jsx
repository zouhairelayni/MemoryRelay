import { useApp } from "../shell/AppContext.js";
import Segmented from "../components/Segmented.jsx";
import Section from "./Section.jsx";

export default function Appearance() {
  const { theme, setTheme } = useApp();
  return (
    <Section title="Appearance">
      <Segmented label="Theme" value={theme} onChange={setTheme} options={[
        { value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" },
      ]} />
    </Section>
  );
}
