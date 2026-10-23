import { useState } from "react";
import Segmented from "../../components/Segmented.jsx";
import { PROVIDERS } from "./providers.js";

export default function KeysScreen({ active }) {
  const [id, setId] = useState(PROVIDERS[0].id);
  const provider = PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];
  const { Panel } = provider;
  return (
    <div className="screen">
      <div className="head">
        <div className="eyebrow">Keys</div>
        <h2>Keys and models</h2>
        <p className="lede">Save more than one key and one model. They rotate, so a rate limit never stops your agents.</p>
      </div>
      {PROVIDERS.length > 1 ? (
        <div style={{ marginBottom: 14 }}>
          <Segmented label="Provider" value={id} onChange={setId} options={PROVIDERS.map((p) => ({ value: p.id, label: p.title }))} />
        </div>
      ) : null}
      <Panel active={active} />
    </div>
  );
}
