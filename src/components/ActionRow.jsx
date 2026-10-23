import { useState } from "react";
import Button from "./Button.jsx";

// A row of buttons. An action with `confirm: { text, yes }` swaps the whole row for an
// inline "are you sure?" with two buttons (no native popup).
// actions: [{ key, label, icon, variant, onClick, confirm? }]
export default function ActionRow({ actions, className = "acts" }) {
  const [pending, setPending] = useState(null);
  const act = actions.find((a) => a.key === pending);

  if (act) {
    return (
      <div className={className + " confirming"}>
        <div className="ask">{act.confirm.text}</div>
        <Button small variant="sdanger" onClick={() => { setPending(null); act.onClick(); }}>{act.confirm.yes || "Yes"}</Button>
        <Button small variant="ghost" onClick={() => setPending(null)}>Cancel</Button>
      </div>
    );
  }
  return (
    <div className={className}>
      {actions.map((a) => (
        <Button key={a.key} small variant={a.variant || "ghost"} icon={a.icon} disabled={a.disabled}
          onClick={() => (a.confirm ? setPending(a.key) : a.onClick())}>{a.label}</Button>
      ))}
    </div>
  );
}
