import Icon from "./Icon.jsx";

export const LEVELS = [
  { value: "read", label: "Read only", icon: "eye", hint: "Can search and read. Cannot change anything." },
  { value: "write", label: "Read and write", icon: "pencil", hint: "Can also save and update memories and upload skills." },
  { value: "full", label: "Full access", icon: "shield", hint: "Can also delete memories and clean up duplicates." },
];

// Three icon segments. The chosen level is spelled out underneath.
export default function AccessPicker({ value, onChange, disabled = false }) {
  const cur = LEVELS.find((l) => l.value === value) || LEVELS[2];
  return (
    <div className="access">
      <div className="seg3" role="radiogroup" aria-label="Access level">
        {LEVELS.map((l) => (
          <button key={l.value} type="button" role="radio" aria-checked={l.value === value} aria-label={l.label} title={l.label}
            disabled={disabled} onClick={() => onChange(l.value)}>
            <Icon name={l.icon} size={17} />
          </button>
        ))}
      </div>
      <span className="small"><b>{cur.label}</b><span className="muted"> {cur.hint}</span></span>
    </div>
  );
}
