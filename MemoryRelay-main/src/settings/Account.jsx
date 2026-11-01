import { useApp } from "../shell/AppContext.js";
import Button from "../components/Button.jsx";
import Section from "./Section.jsx";

export default function Account() {
  const { email, logout } = useApp();
  return (
    <Section title="Account">
      <div className="kv-row"><span className="muted small">Signed in as</span><b className="mono">{email || "owner"}</b></div>
      <div className="row"><Button id="logout" variant="ghost" icon="logout" onClick={logout}>Log out</Button></div>
    </Section>
  );
}
