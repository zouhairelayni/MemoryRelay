import Icon from "./Icon.jsx";

// A round-cornered icon-only button. The label is the tooltip and the screen-reader name.
// variant: "" | "danger" | "solid" | "on"     size: "" | "lg"
export default function IconButton({ icon, label, variant = "", size = "", className = "", type = "button", ...rest }) {
  const cls = ["ib", variant, size, className].filter(Boolean).join(" ");
  return <button type={type} className={cls} aria-label={label} title={label} {...rest}><Icon name={icon} size={size === "lg" ? 20 : 18} /></button>;
}
