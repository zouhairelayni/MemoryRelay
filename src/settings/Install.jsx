import { useInstallPrompt } from "../hooks/useInstallPrompt.js";
import Button from "../components/Button.jsx";
import Section from "./Section.jsx";

export default function Install() {
  const { canInstall, installed, brave, install } = useInstallPrompt();
  return (
    <Section title="App">
      {installed ? <p className="small ok" style={{ margin: 0 }}>Installed. You are using the app.</p> : null}
      {!installed && canInstall ? <Button icon="phone" onClick={install}>Install app</Button> : null}
      {!installed && !canInstall ? (
        <p className="muted small" style={{ margin: 0 }}>
          {brave
            ? "Brave on Android can only add a shortcut. For a real app that survives uninstalling the browser, open this page in Chrome and choose Install app."
            : "Your browser has not offered to install this app yet. Use the browser menu and choose Install app or Add to Home screen."}
        </p>
      ) : null}
    </Section>
  );
}
