import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/system.css";
import "./styles/screens.css";
import "./styles/motion.css";

createRoot(document.getElementById("root")).render(<StrictMode><App /></StrictMode>);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
}
