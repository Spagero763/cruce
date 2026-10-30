import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const agent = process.env.AGENT_URL || "http://localhost:8787";
const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const site = (process.env.SITE_URL || (vercelHost ? `https://${vercelHost}` : "")).replace(/\/$/, "");

// Link previews on WhatsApp, X and Telegram only read absolute image URLs.
const absoluteMeta = (): Plugin => ({
  name: "absolute-meta",
  transformIndexHtml: (html) => (site ? html.replaceAll('content="/', `content="${site}/`) : html),
});

export default defineConfig({
  plugins: [react(), absoluteMeta()],
  server: {
    proxy: { "/api": agent, "/x402": agent, "/.well-known": agent },
  },
  preview: {
    proxy: { "/api": agent, "/x402": agent, "/.well-known": agent },
  },
  build: { target: "es2022", sourcemap: true },
});
