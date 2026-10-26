// The Memory Relay mark: an M drawn as a relay between two nodes.
export default function Logo({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo-mark">
      <rect width="32" height="32" rx="10" fill="currentColor" opacity=".14" />
      <path d="M8.5 22V11.5l7.5 6.5 7.5-6.5V22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="9" r="2" fill="currentColor" />
    </svg>
  );
}
