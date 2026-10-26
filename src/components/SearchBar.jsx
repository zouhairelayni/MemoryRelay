import Icon from "./Icon.jsx";

// One rounded bar: a leading icon, the input, and the screen's main actions as icon buttons on the right.
export default function SearchBar({ icon = "search", children, className = "", ...input }) {
  return (
    <div className={"sbar " + className}>
      <Icon name={icon} size={18} />
      <input className="sin" {...input} />
      {children ? <div className="cluster">{children}</div> : null}
    </div>
  );
}
