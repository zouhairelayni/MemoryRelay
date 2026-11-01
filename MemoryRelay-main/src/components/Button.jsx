import Icon from "./Icon.jsx";

// variant: "solid" (default) | "ghost" | "danger" | "sdanger"
export default function Button({ variant = "solid", small = false, icon, children, className = "", type = "button", ...rest }) {
  const cls = ["btn", variant !== "solid" ? variant : "", small ? "sm" : "", className].filter(Boolean).join(" ");
  return (
    <button type={type} className={cls} {...rest}>
      {icon ? <Icon name={icon} size={small ? 15 : 17} /> : null}
      {children}
    </button>
  );
}
