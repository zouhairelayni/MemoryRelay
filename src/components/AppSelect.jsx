import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Compact app-owned listbox, avoiding Android's viewport-sized native select sheet.
 * Items are {value,label,description?}. The floating layer lives outside scroll-clipped cards.
 */
export default function AppSelect({ value, onChange, options, label, disabled = false, className = "", id }) {
  const [open, setOpen] = useState(false);
  const [bounds, setBounds] = useState(null);
  const anchor = useRef(null);
  const list = useRef(null);
  const listId = useId();
  const chosen = options.find((option) => String(option.value) === String(value)) || options[0];

  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      if (!anchor.current) return;
      const rect = anchor.current.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const width = Math.min(Math.max(rect.width, 218), vw - 24);
      const height = Math.min(276, Math.max(150, vh - 100));
      const above = vh - rect.bottom < Math.min(height, 190) && rect.top > vh - rect.bottom;
      setBounds({
        left: Math.max(12, Math.min(rect.left, vw - width - 12)),
        top: above ? Math.max(12, rect.top - height - 7) : Math.min(vh - 24, rect.bottom + 7),
        width,
        height: Math.min(height, above ? rect.top - 18 : vh - rect.bottom - 20),
      });
    };
    place();
    // Closing on scrolling also prevents detached menus after horizontal swipes.
    const closeOnScroll = (event) => { if (!list.current?.contains(event.target)) setOpen(false); };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", closeOnScroll, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", closeOnScroll, true); };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => {
      if (!anchor.current?.contains(event.target) && !list.current?.contains(event.target)) setOpen(false);
    };
    const keyboard = (event) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); anchor.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keyboard);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", keyboard); };
  }, [open]);

  useEffect(() => {
    if (!open || !bounds) return;
    const target = [...(list.current?.querySelectorAll('[role="option"]') || [])]
      .find((option) => option.getAttribute("aria-selected") === "true") || list.current?.querySelector('[role="option"]');
    target?.focus({ preventScroll: true });
  }, [open, bounds]);

  const choose = (next) => { onChange(next); setOpen(false); anchor.current?.focus(); };
  const keyList = (event) => {
    const buttons = [...(list.current?.querySelectorAll('[role="option"]') || [])];
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement);
    let next = -1;
    if (event.key === "ArrowDown") next = (index + 1) % buttons.length;
    if (event.key === "ArrowUp") next = (index - 1 + buttons.length) % buttons.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = buttons.length - 1;
    if (next >= 0) { event.preventDefault(); buttons[next].focus(); }
    if (event.key === "Tab") setOpen(false);
  };

  return <>
    <button id={id} ref={anchor} type="button" disabled={disabled}
      className={`app-select-trigger ${className}`.trim()} aria-label={label} title={label}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); }
      }} onClick={() => setOpen((previous) => !previous)}>
      <span className="app-select-value">{chosen?.label || "Choose"}</span>
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="m7 10 5 5 5-5"/></svg>
    </button>
    {open && bounds ? createPortal(
      <div id={listId} ref={list} role="listbox" aria-label={label} onKeyDown={keyList}
        className="app-select-menu" style={{ left: bounds.left, top: bounds.top, width: bounds.width, maxHeight: Math.max(80, bounds.height) }}>
        {options.map((option) => <button key={option.value} type="button" role="option"
          aria-selected={String(option.value) === String(value)}
          className={`app-select-option${String(option.value) === String(value) ? " selected" : ""}`}
          onClick={() => choose(option.value)}>
          <span><strong>{option.label}</strong>{option.description ? <small>{option.description}</small> : null}</span>
          {String(option.value) === String(value) ? <span className="app-select-check" aria-hidden="true">✓</span> : null}
        </button>)}
      </div>, document.body) : null}
  </>;
}
