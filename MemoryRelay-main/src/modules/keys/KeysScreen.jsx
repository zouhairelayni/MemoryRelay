import { useState } from "react";
import { useApp } from "../../shell/AppContext.js";
import Segmented from "../../components/Segmented.jsx";
import PageHead from "../../components/PageHead.jsx";
import { PROVIDERS } from "./providers.jsx";
import DelegationPanel from "./DelegationPanel.jsx";

// Models: two jobs, two views. Providers = the keys and models you own. Sub-agents = how agents may borrow them.
export default function KeysScreen({ active }) {
  const { counts } = useApp();
  const [view, setView] = useState(counts.keys ? "sub" : "providers");
  const [id, setId] = useState(PROVIDERS[0].id);
  const provider = PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];
  const { Panel } = provider;
  return (
    <div className="screen">
      <PageHead icon="models" title="Models" sub="Your AI keys rotate, so one rate limit never stops an agent." />
      <div>
        <Segmented label="Models" value={view} onChange={setView} options={[
          { value: "sub", label: "Sub-agents" }, { value: "providers", label: "Providers" },
        ]} />
      </div>
      {view === "sub" ? <DelegationPanel active={active} /> : (
        <>
          <div><Segmented label="Provider" value={id} onChange={setId} options={PROVIDERS.map((p) => ({ value: p.id, label: p.title }))} /></div>
          <Panel active={active} />
        </>
      )}
    </div>
  );
}
