import PageHead from "../../components/PageHead.jsx";
import SkillSelector from "./SkillSelector.jsx";

export default function SkillsScreen({ active }) {
  return (
    <div className="screen">
      <PageHead icon="skills" title="Skills" sub="Add a skill once. Each agent gets only the ones that fit its request." />
      <SkillSelector active={active} />
    </div>
  );
}
