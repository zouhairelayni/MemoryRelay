import { inertProps } from "../lib/inert.js";
import { useSwipePager } from "../hooks/useSwipePager.js";

// The tab screens side by side. All of them stay mounted so scroll position and drafts survive tab changes.
export default function Pager({ panes, index, onChange, swipe }) {
  const { trackRef, viewportProps } = useSwipePager({ index, count: panes.length, onChange: (i) => onChange(panes[i].id), enabled: swipe });
  return (
    <div className="pager" {...viewportProps}>
      <div className="track" ref={trackRef}>
        {panes.map((p, i) => (
          <section key={p.id} className="pane" id={"pane-" + p.id} data-pane={p.id} aria-hidden={i !== index}
            aria-label={p.title} {...inertProps(i !== index)}>
            {p.node}
          </section>
        ))}
      </div>
    </div>
  );
}
