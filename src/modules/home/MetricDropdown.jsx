import { useEffect, useRef, useState } from "react";

/** Inline, accessible chart selector. No native picker or browser-owned modal. */
export default function MetricDropdown({ value, onChange, metrics, functions }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const trigger = useRef(null);
  const options = [{ id: "all", label: "All recorded events", group: "Overview" },
    ...metrics.map(([id, label]) => ({ id, label, group: "Metrics" })),
    ...functions.map(x => ({ id: `fn:${x.category}:${x.action}`, label: x.displayLabel || `${x.category} operation`, group: "Functions" }))];
  const selected = options.find(o => o.id === value) || options[1];
  useEffect(() => {
    if (!open) return undefined;
    function outside(e) { if (!root.current?.contains(e.target)) setOpen(false); }
    function escape(e) { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  const choose = (id) => { onChange(id); setOpen(false); trigger.current?.focus(); };
  const keyboard = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      const buttons = [...root.current.querySelectorAll('[role="option"]')];
      const focused = buttons.indexOf(document.activeElement);
      buttons[(focused + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }
    if (e.key === "Home" && open) { e.preventDefault(); root.current.querySelector('[role="option"]')?.focus(); }
    if (e.key === "End" && open) { e.preventDefault(); const buttons = root.current.querySelectorAll('[role="option"]'); buttons[buttons.length - 1]?.focus(); }
  };
  return <div ref={root} className="metric-dropdown" onKeyDown={keyboard}>
    <button ref={trigger} type="button" className="metric-dropdown-trigger" title={`Choose chart metric: ${selected.label}`} aria-label={`Chart metric: ${selected.label}`} aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen(v => !v)}>
      <span>{selected.label}</span><span className="metric-dropdown-chevron" aria-hidden="true">⌄</span>
    </button>
    {open ? <div className="metric-dropdown-menu" role="listbox" aria-label="Chart metric">
      {options.map((o, i) => <div key={o.id}>
        {(i === 0 || options[i - 1].group !== o.group) ? <div className="metric-dropdown-group" aria-hidden="true">{o.group}</div> : null}
        <button className={"metric-dropdown-option" + (o.id === value ? " selected" : "")} type="button" role="option" aria-selected={o.id === value} onClick={() => choose(o.id)}>
          <span>{o.label}</span><span aria-hidden="true">{o.id === value ? "✓" : ""}</span>
        </button>
      </div>)}
    </div> : null}
  </div>;
}
