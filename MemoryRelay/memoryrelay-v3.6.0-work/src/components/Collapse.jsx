import { inertProps } from "../lib/inert.js";

// Animated drawer (grid-template-rows 0fr -> 1fr). Content is hidden from keyboard and screen readers while closed.
export default function Collapse({ open, children, className = "" }) {
  return (
    <div className={"drawer" + (open ? " open" : "") + (className ? " " + className : "")}>
      <div className="drawer-inner" {...inertProps(!open)}>{children}</div>
    </div>
  );
}
