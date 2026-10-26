import { useState } from "react";
import Segmented from "../../components/Segmented.jsx";
import PageHead from "../../components/PageHead.jsx";
import { PROVIDERS } from "./providers.jsx";
import DelegationPanel from "./DelegationPanel.jsx";

export default function KeysScreen({ active }) {
  const [id, setId] = useState(PROVIDERS[0].id);
  const provider = PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];
  const { Panel } = provider;
  return (
    <div className="screen">
      <PageHead icon="keys" title="Keys and models" sub="Keys and models rotate, so a rate limit never stops your agents." />
      <DelegationPanel active={active} />
      {PROVIDERS.length > 1 ? (
        <div>
          <Segmented label="Provider" value={id} onChange={setId} options={PROVIDERS.map((p) => ({ value: p.id, label: p.title }))} />
        </div>
      ) : null}
      <Panel active={active} />
    </div>
  );
}
