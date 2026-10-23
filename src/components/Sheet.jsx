import { useEffect } from "react";
import Icon from "./Icon.jsx";
import { inertProps } from "../lib/inert.js";
import { useSheetDrag } from "../hooks/useSheetDrag.js";

// Full-height slide-over from the right. Swipe it right, press Esc or use the back button to close.
export default function Sheet({ open, title, onClose, children }) {
  const drag = useSheetDrag({ onClose });
  const { ref } = drag;

  useEffect(() => {
    // After a swipe-close the inline transform is left in place; clear it once the sheet is shut.
    if (!open && ref.current) {
      const t = setTimeout(() => { if (ref.current) ref.current.style.transform = ""; }, 380);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open, ref]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <div className={"scrim" + (open ? " show" : "")} onClick={onClose} aria-hidden="true" />
      <aside ref={ref} className={"sheet" + (open ? " open" : "")} role="dialog" aria-modal="true" aria-label={title}
        aria-hidden={!open} {...inertProps(!open)}
        onPointerDown={drag.onPointerDown} onPointerMove={drag.onPointerMove}
        onPointerUp={drag.onPointerUp} onPointerCancel={drag.onPointerCancel}>
        <header className="sheet-head">
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close settings"><Icon name="back" /></button>
          <h2>{title}</h2>
        </header>
        <div className="sheet-body">{children}</div>
      </aside>
    </>
  );
}
