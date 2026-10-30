// Local preview: an in-process Postgres on disk and real mainnet quotes, with a throwaway key
// that never holds money. Everything up to payment can be clicked through with no accounts.
import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { serve } from "@hono/node-server";
import { boot } from "../src/context.js";
import type { Db } from "../src/db.js";

const DEV_KEY = "0xac0974bec39a17e36ba4a4b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const env = {
  NETWORK: "mainnet",
  AGENT_PRIVATE_KEY: DEV_KEY,
  ATTRIBUTION_TAG: "celo_preview",
  WORKER_SECRET: "local-preview",
  WEB_ORIGIN: "http://localhost:5173",
  PUBLIC_URL: "http://localhost:5173",
  ...process.env,
};

mkdirSync("data", { recursive: true });
const pg = new PGlite("data/pglite");
const db: Db = { query: async <T>(text: string, params?: unknown[]) => (await pg.query(text, params as never[])).rows as T[] };
const { cfg, app, chain } = await boot(env, db);

serve({ fetch: app.fetch, port: cfg.port }, () => {
  console.log(`preview agent ${chain.address}, quotes from mainnet venues, port ${cfg.port}`);
});
