import { useApp } from "../shell/AppContext.js";
import Switch from "../components/Switch.jsx";
import Section from "./Section.jsx";

export default function Gestures() {
  const { swipeTabs, setSwipeTabs } = useApp();
  return (
    <Section title="Gestures">
      <Switch checked={swipeTabs} onChange={setSwipeTabs} id="set-swipe">Swipe left and right to change tab</Switch>
      <p className="muted small" style={{ margin: "10px 0 0" }}>
        Swipe a settings page to the right to close it. Agent cards always swipe on their own.
      </p>
    </Section>
  );
}
