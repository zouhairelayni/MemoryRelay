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
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12ZM12 14.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6Z",
  shield: "M12 3 4.5 6v5.5c0 4.4 3.1 8.3 7.5 9.5 4.4-1.2 7.5-5.1 7.5-9.5V6L12 3ZM9 12l2.2 2.2L15.5 10",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  ban: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM5.6 5.6l12.8 12.8",
  undo: "M9 6 4 11l5 5M4 11h10a5 5 0 0 1 0 10h-3",
  bolt: "M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z",
  refresh: "M20 11a8 8 0 0 0-14.5-3.5L4 9M4 4v5h5M4 13a8 8 0 0 0 14.5 3.5L20 15M20 20v-5h-5",
  wand: "M5 19 17 7l2 2L7 21l-2-2ZM14 4v3M12.5 5.5h3M19 13v3M17.5 14.5h3",
  save: "M5 4h11l3 3v13H5V4ZM8 4v5h7V4M8 20v-6h8v6",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2",
  signout: "M10 4H5v16h5M15 8l4 4-4 4M19 12H9",
  logout: "M10 4H5v16h5M15 8l4 4-4 4M19 12H9",
};

export default function Icon({ name, size = 20, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={PATHS[name] || ""} />
    </svg>
  );
}
