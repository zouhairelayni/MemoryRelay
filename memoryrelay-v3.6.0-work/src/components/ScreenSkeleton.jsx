/** Real layout placeholders; role=status announces loading without reading every line. */
export default function ScreenSkeleton({ type = "list", count = 3, label = "Loading content" }) {
  return <div className="screen-skeleton" role="status" aria-label={label} aria-busy="true">
    {Array.from({ length: count }, (_, i) => <div className={`skeleton-surface ${type === "dashboard" && i === 0 ? "large" : type === "cards" ? "medium" : ""}`} key={i} aria-hidden="true">
      <span className="skeleton-line title"/><span className="skeleton-line"/><span className="skeleton-line short"/>
    </div>)}
  </div>;
}
