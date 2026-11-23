/** A single brand source for toolbar, sign-in and animated welcome. */
export default function Logo({ size = 30, className = "" }) {
  return <img src="/icons/icon-192.png" width={size} height={size} alt=""
    aria-hidden="true" draggable="false" decoding="async" className={`logo-mark ${className}`.trim()} />;
}
