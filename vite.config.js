import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Local preview can explicitly proxy to the deployed Worker on Android, where workerd does not run.
const remote = process.env.MEMORYRELAY_DEV_BACKEND;
const worker = remote || "http://localhost:8787";
const origin = remote && new URL(remote).origin;
const backendProxy = {
  target: worker,
  changeOrigin: true,
  secure: true,
  // The Worker checks the Origin on authenticated writes; keep the browser on localhost
  // while forwarding only backend requests under the actual Worker's origin.
  ...(origin ? {
    configure(proxy) {
      proxy.on("proxyReq", (req) => req.setHeader("Origin", origin));
    },
  } : {}),
};
const proxy = Object.fromEntries(
  ["/api", "/auth"].map((path) => [path, backendProxy])
);
if (!remote) Object.assign(proxy, {
  "/mcp": backendProxy, "/oauth": backendProxy, "/.well-known": backendProxy,
});
export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", proxy },
  preview: { host: "127.0.0.1", proxy },
  build: { outDir: "dist", sourcemap: false },
});
