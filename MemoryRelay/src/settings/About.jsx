import { useEffect, useState } from "react";
import { overview } from "../api/endpoints.js";
import Section from "./Section.jsx";

export default function About() {
  const [build, setBuild] = useState("");
  useEffect(() => { overview.build().then((d) => setBuild(d.build)).catch(() => {}); }, []);
  return (
    <Section title="About">
      <div className="kv-row"><span className="muted small">Server build</span><b className="mono" id="build">{build || "..."}</b></div>
      <p className="muted small" style={{ margin: "10px 0 0" }}>Memory Relay: one space that connects and empowers your agents.</p>
    </Section>
  );
}
