import { ACCENTS, iconFor } from "../hooks/useAccent.js";

/** Accessible color + artwork choices; native radio semantics, not a platform picker. */
export default function AccentPicker({ value, onChange, label = "Accent theme" }) {
  return <div className="accent-grid" role="radiogroup" aria-label={label}>
    {ACCENTS.map((a) => <button type="button" key={a.id}
      className={`accent-option${value === a.id ? " selected" : ""}`}
      role="radio" aria-checked={value === a.id} aria-label={`${a.name} accent theme`}
      title={`${a.name} accent · ${value === a.id ? "selected" : "choose"}`}
      onClick={() => onChange(a.id)}>
      <img alt="" src={iconFor(a.id, 192)} width="48" height="48" loading="lazy"/>
      <span>{a.name}</span><span className="accent-check" aria-hidden="true">{value === a.id ? "✓" : ""}</span>
    </button>)}
  </div>;
}
