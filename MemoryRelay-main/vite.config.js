import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run dev` serves the React app with hot reload and forwards the API to `wrangler dev` (port 8787).
const worker = "http://localhost:8787";
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": worker, "/auth": worker, "/mcp": worker } },
  build: { outDir: "dist", sourcemap: false },
});
