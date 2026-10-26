import Icon from "./Icon.jsx";

// Every screen starts the same way: an icon chip, a title, one line of help, optional actions on the right.
export default function PageHead({ icon, title, sub, children }) {
  return (
    <header className="phead">
      <span className="chip lg"><Icon name={icon} size={22} /></span>
      <div className="grow"><h2>{title}</h2>{sub ? <p>{sub}</p> : null}</div>
      {children}
    </header>
  );
}
