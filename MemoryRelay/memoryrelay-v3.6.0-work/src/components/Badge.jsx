// tone: "ok" | "bad" | "rule" | "tag"
export default function Badge({ tone = "tag", children }) {
  return <span className={"badge " + tone}>{children}</span>;
}
