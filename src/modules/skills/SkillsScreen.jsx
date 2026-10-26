import PageHead from "../../components/PageHead.jsx";
import SkillSelector from "./SkillSelector.jsx";

export default function SkillsScreen({ active }) {
  return (
    <div className="screen">
      <PageHead icon="skills" title="Skills" sub="Import once. Every agent gets only the skills that fit its request." />
      <SkillSelector active={active} />
    </div>
  );
}
