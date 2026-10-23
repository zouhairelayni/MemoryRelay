import Icon from "../components/Icon.jsx";

// Bottom navigation. The pill under the active tab slides to the new position.
export default function TabBar({ tabs, activeId, onSelect }) {
  const idx = Math.max(0, tabs.findIndex((t) => t.id === activeId));
  return (
    <nav className="tabbar" aria-label="Main">
      <div className="tabbar-in" style={{ "--n": tabs.length, "--i": idx }}>
        <span className="tab-pill" aria-hidden="true" />
        {tabs.map((t) => (
          <button key={t.id} type="button" className={"tab" + (t.id === activeId ? " on" : "")} data-tab={t.id}
            aria-current={t.id === activeId ? "page" : undefined} onClick={() => onSelect(t.id)}>
            <Icon name={t.icon} size={22} />
            <span>{t.title}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
