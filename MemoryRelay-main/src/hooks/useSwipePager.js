import { useCallback, useEffect, useRef } from "react";
import { lockAxis, pageDirection, rubber } from "../lib/gesture.js";

const IGNORE = "[data-noswipe],input,textarea,select,[contenteditable='true']";
const EASE = "transform .34s cubic-bezier(.2,.8,.2,1)";

// Horizontal pager: the track follows your finger and settles on the nearest page.
// Returns a ref for the track element and the pointer handlers for the viewport.
// Vertical scrolling stays native (CSS touch-action: pan-y on the viewport).
export function useSwipePager({ index, count, onChange, enabled = true }) {
  const trackRef = useRef(null);
  const viewportRef = useRef(null);
  const g = useRef(null);
  const suppressClick = useRef(false);

  const place = useCallback((i, extraPx = 0, animate = true) => {
    const t = trackRef.current;
    if (!t) return;
    t.style.transition = animate ? EASE : "none";
    t.style.transform = extraPx
      ? "translate3d(calc(" + -i * 100 + "% + " + extraPx + "px),0,0)"
      : "translate3d(" + -i * 100 + "%,0,0)";
  }, []);

  useEffect(() => { place(index, 0, true); }, [index, place]);

  const onPointerDown = useCallback((e) => {
    if (!enabled || count < 2) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target.closest && e.target.closest(IGNORE)) return;
    g.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), axis: null, dx: 0 };
  }, [enabled, count]);

  const onPointerMove = useCallback((e) => {
    const s = g.current;
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!s.axis) {
      s.axis = lockAxis(dx, dy);
      if (s.axis === "y") { g.current = null; return; }
      if (s.axis === "x") {
        try { viewportRef.current.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        viewportRef.current.classList.add("dragging");
      }
    }
    if (s.axis !== "x") return;
    s.dx = dx;
    const edge = (index === 0 && dx > 0) || (index === count - 1 && dx < 0);
    place(index, edge ? rubber(dx) : dx, false);
  }, [index, count, place]);

  const finish = useCallback((e, cancelled) => {
    const s = g.current;
    if (!s || (e && e.pointerId !== s.id)) return;
    g.current = null;
    const vp = viewportRef.current;
    if (vp) vp.classList.remove("dragging");
    if (s.axis !== "x") return;
    suppressClick.current = true;
    setTimeout(() => { suppressClick.current = false; }, 60);
    const width = vp ? vp.clientWidth : 360;
    const dir = cancelled ? 0 : pageDirection(s.dx, width, performance.now() - s.t);
    const next = Math.max(0, Math.min(count - 1, index + dir));
    place(next, 0, true);
    if (next !== index) onChange(next);
  }, [index, count, onChange, place]);

  const onClickCapture = useCallback((e) => {
    if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); }
  }, []);

  return {
    trackRef,
    viewportProps: {
      ref: viewportRef,
      onPointerDown,
      onPointerMove,
      onPointerUp: (e) => finish(e, false),
      onPointerCancel: (e) => finish(e, true),
      onClickCapture,
    },
  };
}
