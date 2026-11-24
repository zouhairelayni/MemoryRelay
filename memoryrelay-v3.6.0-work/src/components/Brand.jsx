import { BRANDS, detectBrand } from "../../shared/brands.js";

// The connected app's logo (Claude, ChatGPT, Gemini, Cursor...). When the app is not recognised the tile shows the first letter of its
// name in that agent's cable colour. `names` are the things that can reveal the app: the connection name and what the app reported.
export default function Brand({ names = [], size = 36, cable }) {
  const id = detectBrand(...names);
  const label = id ? BRANDS[id].label : String(names.find(Boolean) || "App");
  const style = { width: size, height: size, borderRadius: Math.round(size * 0.3), ...(cable ? { "--cable": cable } : null) };
  return (
    <span className={"brand-tile" + (id ? "" : " mono-tile")} style={style} role="img" aria-label={label}>
      {id ? (
        <svg width={Math.round(size * 0.62)} height={Math.round(size * 0.62)} viewBox="0 0 24 24" aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: BRANDS[id].body }} />
      ) : (
        <span style={{ fontSize: Math.round(size * 0.46) }}>{label.trim().charAt(0).toUpperCase() || "?"}</span>
      )}
    </span>
  );
}
