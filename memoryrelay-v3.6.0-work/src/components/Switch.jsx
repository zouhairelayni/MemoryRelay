export default function Switch({ checked, onChange, disabled = false, children, title, ...rest }) {
  return (
    <label className="sw" title={title}>
      <input type="checkbox" aria-label={rest["aria-label"] || title || "Toggle setting"} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} {...rest} />
      {children ? <span>{children}</span> : null}
    </label>
  );
}
