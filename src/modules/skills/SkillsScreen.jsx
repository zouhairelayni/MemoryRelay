import { useState } from "react";
import PageHead from "../../components/PageHead.jsx";
import SkillSelector from "./SkillSelector.jsx";
import ScriptBank from "./ScriptBank.jsx";
import GithubSources from "./GithubSources.jsx";

export default function SkillsScreen({ active }) {
  const [revision, setRevision] = useState(0);
  return (
    <div className="screen">
      <PageHead icon="skills" title="Skills" sub="Add a skill once. Each agent gets only the ones that fit its request." />
      <SkillSelector active={active} onDeleted={() => setRevision(v => v + 1)} />
      <GithubSources active={active} onUpdated={() => setRevision(v => v + 1)} />
      <ScriptBank active={active} revision={revision} />
    </div>
  );
}
