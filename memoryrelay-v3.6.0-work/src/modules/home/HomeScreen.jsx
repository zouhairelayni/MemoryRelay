import { useState } from "react";
import MonitorPanel from "./MonitorPanel.jsx";
import { useApp } from "../../shell/AppContext.js";
import { skills as skillsApi } from "../../api/endpoints.js";
import { usePolling } from "../../hooks/usePolling.js";
import { useCountUp } from "../../hooks/useCountUp.js";
import { useInstallPrompt } from "../../hooks/useInstallPrompt.js";
import InstallChooser from "../../components/InstallChooser.jsx";
import Icon from "../../components/Icon.jsx";
import Button from "../../components/Button.jsx";

/** Home is an analytics overview. Agent connections and their live status live in Connections. */
export default function HomeScreen({ active }) {
  const { counts, status, go } = useApp();
  const install = useInstallPrompt();
  const [skillInfo, setSkillInfo] = useState(null);
  usePolling(() => skillsApi.list().then(d => {
    const items = d.skills || [];
    setSkillInfo({ total: items.length, pending: items.filter(s => s.pending).length });
  }).catch(() => {}), 30000, active);
  const memories = useCountUp(counts.memories);
  const rules = useCountUp(counts.rules);
  const skills = useCountUp(skillInfo?.total || 0);
  const keys = useCountUp(counts.keys);
  const pending = skillInfo?.pending || 0;
  const live = status.live;
  const library = [
    { to: "memory", icon: "memory", label: "Memories", number: memories },
    { to: "memory", icon: "lock", label: "Rules", number: rules },
    { to: "skills", icon: "skills", label: "Skills", number: skills },
    { to: "keys", icon: "keys", label: "AI keys", number: keys },
  ];
  return <div className="screen home-screen enter">
    <header className="home-hero">
      <div className="home-hero-top"><span className="dash-eyebrow">WORKSPACE / OVERVIEW</span>
        <span className={`dash-health ${live === false ? "down" : live ? "up" : "loading"}`}>
          <span aria-hidden="true"/>{live === false ? "Needs attention" : live ? "Systems online" : "Checking status"}
        </span>
      </div>
      <h1>Overview</h1><p>Usage, activity and knowledge health.</p>
    </header>
    <section className="overview-library" aria-label="Knowledge library">
      <div className="overview-library-head"><span className="dash-eyebrow">YOUR LIBRARY</span><span>Available to your agents</span></div>
      <div className="overview-library-grid">{library.map(item =>
        <button type="button" key={item.label} className="overview-library-card" title={`Open ${item.label.toLowerCase()}`} onClick={() => go(item.to)}>
          <span className="overview-library-icon"><Icon name={item.icon} size={18}/></span>
          <strong>{item.number}</strong><span>{item.label}</span>
        </button>
      )}</div>
    </section>
    <MonitorPanel active={active}/>
    {(pending > 0 || live === false || !counts.keys) ? <section className="home-alerts" aria-label="Needs attention">
      <h2 className="section-title">Needs attention</h2>
      {pending > 0 ? <button type="button" className="attn" onClick={() => go("skills")}>
        <span className="chip"><Icon name="skills"/></span><span className="tt"><b>{pending} skills to review</b><small>Open Skills to approve pending imports</small></span><Icon name="chev" className="chev-r"/>
      </button> : null}
      {live === false ? <p className="notice bad" role="alert">The service is not responding. Open Connections to diagnose.</p> : null}
      {!counts.keys ? <button type="button" className="attn" onClick={() => go("keys")}>
        <span className="chip"><Icon name="keys"/></span><span className="tt"><b>Add an AI provider</b><small>Enable skill picking and housekeeping</small></span><Icon name="chev" className="chev-r"/>
      </button> : null}
    </section> : null}
    {install.canInstall ? <section className="card tip">
      <div className="tip-t"><span className="chip"><Icon name="phone" size={18}/></span> Install Memory Relay</div>
      <p className="muted small">Open your workspace from your home screen.</p>
      <InstallChooser/>
    </section> : null}
  </div>;
}
