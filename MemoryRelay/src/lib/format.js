export const fmtBytes = (n) => (n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(2) + " MB");
export const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);
export const hasRule = (tags) => ("," + String(tags || "").toLowerCase().replace(/ /g, "") + ",").includes(",rules,");
export const splitTags = (tags) => String(tags || "").split(",").map((t) => t.trim()).filter((t) => t && t.toLowerCase() !== "rules");
