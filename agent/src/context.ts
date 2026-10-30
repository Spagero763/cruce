import { createApp } from "./app.js";
import { createBuy } from "./buy.js";
import { createChain } from "./chain.js";
import { loadConfig } from "./config.js";
import { Store, type Db } from "./db.js";
import { createEngine } from "./engine.js";
import { connect } from "./pg.js";
import { createRates } from "./rates.js";
import { Textile } from "./textile.js";
import { Uniswap } from "./uniswap.js";
import { createWorker } from "./worker.js";

/** Wires everything once per process; shared by the local server and the serverless entry. */
export async function boot(env: NodeJS.ProcessEnv = process.env, db?: Db) {
  const cfg = loadConfig(env);
  if (!db && !cfg.databaseUrl) throw new Error("DATABASE_URL is not set");
  const store = new Store(db ?? connect(cfg.databaseUrl!));
  await store.migrate();
  const chain = createChain(cfg, store);
  const buy = createBuy(cfg, store);
  const venues = { textile: new Textile(cfg.textileUrl, cfg.chain.id, cfg.textileApiKey), uniswap: new Uniswap(chain.pub) };
  const rates = createRates(store, buy);
  const engine = createEngine(cfg, store, chain, venues);
  const worker = createWorker(cfg, store, chain, engine, rates);
  const app = createApp(cfg, store, chain, venues, rates, engine, worker);
  return { cfg, store, chain, buy, venues, rates, engine, worker, app };
}
