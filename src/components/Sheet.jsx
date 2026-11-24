import { useEffect, useRef } from "react";
import Icon from "./Icon.jsx";
import { inertProps } from "../lib/inert.js";
import { useSheetDrag } from "../hooks/useSheetDrag.js";

// Full-height slide-over from the right. Swipe it right, press Esc or use the back button to close.
export default function Sheet({ open, title, onClose, closeLabel = "Close settings", children }) {
  const drag = useSheetDrag({ onClose });
  const { ref } = drag;
  const previousFocus = useRef(null);

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
    previousFocus.current = document.activeElement;
    const sheet = ref.current;
    sheet?.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if (e.key !== "Tab" || !sheet) return;
      const visible = [...sheet.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]')]
        .filter(el=>el.getClientRects().length);
      if (!visible.length) { e.preventDefault();return; }
      const first=visible[0],last=visible[visible.length-1];
      if (e.shiftKey && document.activeElement===first) { e.preventDefault();last.focus(); }
      if (!e.shiftKey && document.activeElement===last) { e.preventDefault();first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {window.removeEventListener("keydown", onKey);previousFocus.current?.focus?.({preventScroll:true});};
  }, [open, onClose, ref]);

  return (
    <>
      <div className={"scrim" + (open ? " show" : "")} onClick={onClose} aria-hidden="true" />
      <aside ref={ref} className={"sheet" + (open ? " open" : "")} role="dialog" aria-modal="true" aria-label={title}
        aria-hidden={!open} {...inertProps(!open)}
        onPointerDown={drag.onPointerDown} onPointerMove={drag.onPointerMove}
        onPointerUp={drag.onPointerUp} onPointerCancel={drag.onPointerCancel}>
        <header className="sheet-head">
          <button type="button" className="icon-btn" onClick={onClose} aria-label={closeLabel}><Icon name="back" /></button>
          <h2>{title}</h2>
        </header>
        <div className="sheet-body">{children}</div>
      </aside>
    </>
  );
}
