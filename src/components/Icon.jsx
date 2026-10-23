// Small stroke icons (24x24). Add new ones to PATHS.
const PATHS = {
  home: "M3 11.5 12 4l9 7.5M5 10v10h5v-6h4v6h5V10",
  agents: "M9 3v4M15 3v4M7 7h10v4a5 5 0 0 1-10 0V7ZM12 16v5",
  memory: "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4ZM5 17a3 3 0 0 1 3-3h11M9 8h6",
  keys: "M14.5 9.5a4.5 4.5 0 1 1-1.3 3.2L5 20.5V17H3v-2l6.3-6.3A4.5 4.5 0 0 1 14.5 9.5ZM16 9h.01",
  skills: "M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3L12 3ZM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15Z",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 13.5a7.7 7.7 0 0 0 0-3l2-1.5-2-3.4-2.3.9a7.8 7.8 0 0 0-2.6-1.5L14 2.5h-4l-.5 2.5a7.8 7.8 0 0 0-2.6 1.5l-2.3-.9-2 3.4 2 1.5a7.7 7.7 0 0 0 0 3l-2 1.5 2 3.4 2.3-.9a7.8 7.8 0 0 0 2.6 1.5l.5 2.5h4l.5-2.5a7.8 7.8 0 0 0 2.6-1.5l2.3.9 2-3.4-2-1.5Z",
  plus: "M12 5v14M5 12h14",
  check: "M5 12.5l4.5 4.5L19 7.5",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6v-9Z",
  chev: "M6 9l6 6 6-6",
  back: "M15 5l-7 7 7 7",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  pencil: "M4 20l4-1 11-11-3-3L5 16l-1 4ZM14 7l3 3",
  copy: "M9 9h10v11H9V9ZM5 15V4h10",
  up: "M12 19V6M6 12l6-6 6 6",
  down: "M12 5v13M6 12l6 6 6-6",
  x: "M6 6l12 12M18 6 6 18",
  download: "M12 4v11M7 11l5 5 5-5M5 20h14",
  upload: "M12 16V5M7 9l5-5 5 5M5 20h14",
  broom: "M14 3l7 7-4 1-4-4 1-4ZM12 8l-8 8 3 3 8-8M7 19l-3 2 2-3",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0",
  swipe: "M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z",
  info: "M12 11v6M12 7.5v.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
  phone: "M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM11 18h2",
  logout: "M10 4H5v16h5M15 8l4 4-4 4M19 12H9",
};

export default function Icon({ name, size = 20, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={PATHS[name] || ""} />
    </svg>
  );
}
