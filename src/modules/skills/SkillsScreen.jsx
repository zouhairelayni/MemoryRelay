import { useEffect, useState } from "react";
import { services } from "../../api/endpoints.js";
import SkillSelector from "./SkillSelector.jsx";

export default function SkillsScreen({ active }) {
  const [connections, setConnections] = useState([]);
  useEffect(() => { if (active) services.list().then(setConnections).catch(() => {}); }, [active]);
  return (
    <div className="screen">
      <div className="head">
        <div className="eyebrow">Skills</div>
        <h2>Skills</h2>
        <p className="lede">Choose which skills each agent can use.</p>
      </div>
      <SkillSelector connections={connections} />
    </div>
  );
}
