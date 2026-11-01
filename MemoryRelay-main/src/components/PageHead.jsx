// Every screen starts the same way: one large title, one line of help, optional actions on the right.
// (`icon` is accepted but not drawn: the tab bar already carries it.)
export default function PageHead({ title, sub, children }) {
  return (
    <header className="phead">
      <div className="grow"><h2>{title}</h2>{sub ? <p>{sub}</p> : null}</div>
      {children}
    </header>
  );
}
