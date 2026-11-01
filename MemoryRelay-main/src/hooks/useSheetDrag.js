import { useCallback, useRef } from "react";
import { lockAxis, pageDirection } from "../lib/gesture.js";

const IGNORE = "input,textarea,select,[data-noswipe]";

// Swipe a slide-over sheet to the right to close it. The sheet follows your finger.
export function useSheetDrag({ onClose }) {
  const ref = useRef(null);
  const g = useRef(null);

  const onPointerDown = useCallback((e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target.closest && e.target.closest(IGNORE)) return;
    g.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), axis: null, dx: 0 };
  }, []);

  const onPointerMove = useCallback((e) => {
    const s = g.current;
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!s.axis) {
      s.axis = lockAxis(dx, dy);
      if (s.axis === "y") { g.current = null; return; }
      if (s.axis === "x") { try { ref.current.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
    }
    if (s.axis !== "x") return;
    s.dx = Math.max(0, dx);
    ref.current.style.transition = "none";
    ref.current.style.transform = "translateX(" + s.dx + "px)";
  }, []);

  const finish = useCallback((cancelled) => {
    const s = g.current;
    if (!s) return;
    g.current = null;
    if (s.axis !== "x") return;
    const el = ref.current;
    el.style.transition = "";
    const width = el.clientWidth || 360;
    const close = !cancelled && pageDirection(-s.dx, width, performance.now() - s.t) === 1 && s.dx > 0;
    // On close the inline transform stays until the Sheet clears it, so there is no jump back.
    if (close) { el.style.transform = "translateX(100%)"; onClose(); }
    else el.style.transform = "";
  }, [onClose]);

  return { ref, onPointerDown, onPointerMove, onPointerUp: () => finish(false), onPointerCancel: () => finish(true) };
}
