export default function Section({ title, children }) {
  return (
    <section className="set-sec">
      <h3 className="set-title">{title}</h3>
      <div className="card flat">{children}</div>
    </section>
  );
}
