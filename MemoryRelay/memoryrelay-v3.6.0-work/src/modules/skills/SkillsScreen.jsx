import { useEffect, useState } from "react";
import PageHead from "../../components/PageHead.jsx";
import SkillSelector from "./SkillSelector.jsx";
import ScriptBank from "./ScriptBank.jsx";
import GithubSources from "./GithubSources.jsx";

export default function SkillsScreen({ active }) {
  const [revision, setRevision] = useState(0);
  const [repoDetail, setRepoDetail] = useState(null);
  useEffect(() => {
    if (!repoDetail) return;
    const pane = document.querySelector('[data-pane="skills"]');
    if (pane) pane.scrollTop = 0;
    const closeOnEscape = (event) => { if (event.key === "Escape") setRepoDetail(null); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [repoDetail]);
  if (repoDetail) return <div className="screen skills-screen repo-screen">
    <GithubSources active={active} focusRepo={repoDetail} onCloseRepo={()=>setRepoDetail(null)} onUpdated={()=>setRevision(v=>v+1)}/>
  </div>;
  return (
    <div className="screen skills-screen">
      <PageHead icon="skills" title="Skills" sub="Add a skill once. Each agent gets only the ones that fit its request." />
      <SkillSelector active={active} onDeleted={() => setRevision(v => v + 1)} />
      <GithubSources active={active} onUpdated={() => setRevision(v => v + 1)} onOpenRepo={setRepoDetail} />
      <ScriptBank active={active} revision={revision} />
    </div>
  );
}
