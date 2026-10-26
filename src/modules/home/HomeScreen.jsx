import { useApp } from "../../shell/AppContext.js";
import { MODULES } from "../index.js";
import Icon from "../../components/Icon.jsx";
import IconButton from "../../components/IconButton.jsx";
import Button from "../../components/Button.jsx";
import Logo from "../../components/Logo.jsx";
import { useInstallPrompt } from "../../hooks/useInstallPrompt.js";

const STATS = [
  { key: "memories", label: "Memories", to: "memory", icon: "memory" },
  { key: "rules", label: "Rules", to: "memory", icon: "lock" },
  { key: "connections", label: "Agents", to: "agents", icon: "agents" },
  { key: "keys", label: "Keys", to: "keys", icon: "keys" },
];

export default function HomeScreen() {
  const { counts, status, test, go } = useApp();
  const install = useInstallPrompt();
  const tone = status.live === null ? "" : status.live ? "ok" : "bad";

  return (
    <div className="screen">
      <section className="hero-card card">
        <div className="hero-top"><Logo size={26} /><span className="eyebrow">Memory Relay</span></div>
        <h1>One space. <em>Every</em> agent.</h1>
        <div className="live">
          <div className="live-main">
            <span className={"pulse " + tone} id="status-dot" />
            <div>
              <div className="live-t" id="status-text">{status.text}</div>
              <div className="muted small">{status.meta}</div>
            </div>
          </div>
          <IconButton icon="refresh" label="Test the connection now" onClick={test} />
        </div>
        <p className="muted small" style={{ margin: "12px 0 0" }}>
          {counts.last_call ? "Last request from an agent: " + counts.last_call : "No agent has connected yet"}
        </p>
      </section>

      <div className="stats">
        {STATS.map((s) => (
          <button key={s.key} type="button" className="stat" onClick={() => go(s.to)}>
            <span className="chip"><Icon name={s.icon} size={16} /></span>
            <b data-stat={s.key}>{counts[s.key]}</b>
            <span className="l">{s.label}</span>
          </button>
        ))}
      </div>

      <h2 className="section-title">Modules</h2>
      <div className="stack">
        {MODULES.filter((m) => m.id !== "home").map((m) => (
          <button key={m.id} type="button" className="module-row" onClick={() => go(m.id)}>
            <span className="ic ok"><Icon name={m.icon} /></span>
            <span className="tt"><b>{m.title}</b><small>{m.blurb}</small></span>
            <Icon name="chev" className="chev-r" />
          </button>
        ))}
      </div>

      {install.canInstall ? (
        <div className="card tip">
          <div className="tip-t"><span className="chip"><Icon name="phone" size={18} /></span> Install Memory Relay</div>
          <p className="muted small">Add it to your home screen so it opens like an app.</p>
          <Button small onClick={install.install}>Install app</Button>
        </div>
      ) : null}
    </div>
  );
}
