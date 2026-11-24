// Pure helpers for horizontal swipe decisions. No DOM here, so they are easy to test.
export const LOCK_PX = 8;        // movement before we decide horizontal or vertical
export const CARD_THRESHOLD = 50; // px to flip a card
export const PAGE_THRESHOLD = 0.2; // fraction of the width to change tab
export const FLICK_SPEED = 0.45;  // px per ms that counts as a flick

// Returns "x", "y" or null once the gesture has moved far enough to tell.
export function lockAxis(dx, dy) {
  if (Math.abs(dx) < LOCK_PX && Math.abs(dy) < LOCK_PX) return null;
  return Math.abs(dx) > Math.abs(dy) * 1.2 ? "x" : "y";
}

// Where a page swipe should end up: -1 (previous), 0 (stay) or 1 (next).
export function pageDirection(dx, width, elapsedMs) {
  const speed = Math.abs(dx) / Math.max(elapsedMs, 1);
  const passed = Math.abs(dx) > width * PAGE_THRESHOLD || (speed > FLICK_SPEED && Math.abs(dx) > 24);
  if (!passed) return 0;
  return dx < 0 ? 1 : -1;
}

// Slows the drag down when there is no page in that direction.
export const rubber = (dx) => dx * 0.3;
