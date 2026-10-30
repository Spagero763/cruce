import { serve } from "@hono/node-server";
import { boot } from "./context.js";

const { cfg, chain, app, worker } = await boot();

serve({ fetch: app.fetch, port: cfg.port }, () => {
  console.log(`cruce agent ${chain.address} on ${cfg.network}, port ${cfg.port}`);
});

const every = Number(process.env.WORKER_INTERVAL_MS ?? 60_000);
setInterval(() => void worker.tick().then((r) => (r.resumed || r.refunded) && console.log("[worker]", r)), every);
