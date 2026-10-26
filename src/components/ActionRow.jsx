import { useState } from "react";
import Button from "./Button.jsx";
import IconButton from "./IconButton.jsx";

// A cluster of icon buttons (the label is the tooltip). An action with `confirm: { text, yes }` swaps
// the cluster for an inline "are you sure?" with two buttons (no native popup).
// actions: [{ key, label, icon, variant, onClick, confirm?, disabled?, on? }]
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
    <div className={className + " cluster"}>
      {actions.map((a) => {
        const go = () => (a.confirm ? setPending(a.key) : a.onClick());
        return a.icon
          ? <IconButton key={a.key} icon={a.icon} label={a.label} disabled={a.disabled} onClick={go}
              variant={a.on ? "on" : a.variant === "danger" ? "danger" : a.variant === "solid" ? "solid" : ""} />
          : <Button key={a.key} small variant={a.variant || "ghost"} disabled={a.disabled} onClick={go}>{a.label}</Button>;
      })}
    </div>
  );
}
