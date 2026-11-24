import { useAccent, iconFor } from "../hooks/useAccent.js";
/** Shared, approved artwork. Three clipped images animate into the exact original mark.
 * No SVG approximation replaces the brand image; accessibility sees one decorative icon. */
export default function Logo({ size = 30, className = "", animated = false }) {
  const [accent] = useAccent();
  const image = iconFor(accent, 192);
  const cls = `logo-ribbon${animated ? " logo-ribbon-animated" : ""} ${className}`.trim();
  return <span className={cls} style={{ width: size, height: size }} aria-hidden="true">
    <img src={image} width={size} height={size} alt="" decoding="async" draggable="false" className="logo-mark logo-ribbon-settled" />
    {animated ? <span className="ribbon-folds" aria-hidden="true">
      <span className="ribbon-fold ribbon-fold-left" style={{ backgroundImage: `url(${image})` }}/>
      <span className="ribbon-fold ribbon-fold-middle" style={{ backgroundImage: `url(${image})` }}/>
      <span className="ribbon-fold ribbon-fold-right" style={{ backgroundImage: `url(${image})` }}/>
    </span> : null}
  </span>;
}
