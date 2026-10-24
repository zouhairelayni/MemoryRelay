import SkillSelector from "./SkillSelector.jsx";

export default function SkillsScreen({ active }) {
  return (
    <div className="screen">
      <div className="head">
        <div className="eyebrow">Skills</div>
        <h2>Skill Genie</h2>
        <p className="lede">Import skills once. Every agent gets only the ones that fit its request.</p>
      </div>
      <SkillSelector active={active} />
    </div>
  );
}
