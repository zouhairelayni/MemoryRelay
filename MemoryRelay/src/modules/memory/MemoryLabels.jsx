// Compact, accessible, consistently colored labels independent of legacy context tags.
import React from "react";

const CATEGORIES = [
  ["app", "App", "indigo"],
  ["platforms", "Platform", "cyan"],
  ["feature", "Feature", "mint"],
  ["version", "Build / release", "amber"],
  ["languages", "Language", "rose"],
  ["stack", "Stack", "slate"],
];

export default function MemoryLabels({ metadata }) {
  const meta = metadata || {};
  const entries = CATEGORIES.flatMap(([key, label, color]) => {
    const val = meta[key];
    return (Array.isArray(val) ? val : val ? [val] : []).map((value) => ({ key, label, color, value }));
  });
  if (!entries.length) return null;
  return (
    <div className="memory-labels" aria-label="Structured memory labels">
      {entries.map(({ key, label, color, value }, i) => (
        <span key={`${key}-${value}-${i}`} className={`memory-label memory-label-${color}`} title={`${label}: ${value}`}>
          <span className="memory-label-category">{label}</span><strong>{value}</strong>
        </span>
      ))}
    </div>
  );
}
