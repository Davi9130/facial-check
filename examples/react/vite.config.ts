import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * `npm run dev` serves on http://localhost:5173. Browsers allow the camera
 * on `localhost` without HTTPS. To open the demo from another device (e.g. a
 * phone on the same network) the page must be served over HTTPS:
 * `npm run dev:https` uses `certs/key.pem` + `certs/cert.pem` (see README).
 */
export default defineConfig(({ mode }) => {
  const https = mode === "https" ? loadCertificates() : undefined;
  return {
    plugins: [react()],
    // `facial-check` is linked from `../..`, which has its own React copy in
    // node_modules (dev dependency). Dedupe so the app and the SDK share one React.
    resolve: { dedupe: ["react", "react-dom"] },
    server: https ? { https, host: true } : {},
  };
});

function loadCertificates() {
  const key = resolve("certs/key.pem");
  const cert = resolve("certs/cert.pem");
  if (!existsSync(key) || !existsSync(cert)) {
    throw new Error("HTTPS mode needs certs/key.pem and certs/cert.pem (see examples/react/README.md).");
  }
  return { key: readFileSync(key), cert: readFileSync(cert) };
}
