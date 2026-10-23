// tone: "muted" | "ok" | "bad"
export default function Notice({ tone = "muted", children, ...rest }) {
  if (!children) return null;
  return <p className={"notice small " + tone} role={tone === "bad" ? "alert" : "status"} {...rest}>{children}</p>;
}
