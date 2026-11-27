import { createApp } from "./app.js";
import { createAvailability } from "./availability.js";
import { BudgetExceeded, createBuy } from "./buy.js";
import { createChain } from "./chain.js";
import { loadConfig, type Config } from "./config.js";
import { CURRENCIES } from "./currencies.js";
import { Store, type Db } from "./db.js";
import { createEngine } from "./engine.js";
import { connect } from "./pg.js";
import { createRates, type PaidFeed } from "./rates.js";
import { payTarget, readOffers } from "./target.js";
import { Textile } from "./textile.js";
import { Uniswap } from "./uniswap.js";
import { createWorker } from "./worker.js";

/** Wires everything once per process; shared by the local server and the serverless entry. */
export async function boot(env: NodeJS.ProcessEnv = process.env, db?: Db) {
  const cfg = loadConfig(env);
  if (!db && !cfg.databaseUrl && env.PGLITE_DIR) db = await pglite(env.PGLITE_DIR);
  if (!db && !cfg.databaseUrl) throw new Error("DATABASE_URL is not set");
  const store = new Store(db ?? connect(cfg.databaseUrl!));
  await store.migrate();
  const chain = createChain(cfg, store);
  const buy = createBuy(cfg, store);
  const venues = { textile: new Textile(cfg.textileUrl, cfg.chain.id, cfg.textileApiKey), uniswap: new Uniswap(chain.pub) };
  const rates = createRates(store, buy, fetch, console, feeds(cfg, store, chain));
  const engine = createEngine(cfg, store, chain, venues);
  const availability = createAvailability(venues);
  const worker = createWorker(cfg, store, chain, engine, rates);
  const app = createApp(cfg, store, chain, venues, rates, engine, availability, worker);
  return { cfg, store, chain, buy, venues, rates, engine, availability, worker, app };
}

/**
 * Data bought from other agents on Celo. Paid from the agent's wallet in a dollar stablecoin, under
 * the same per-call and daily caps as buy, and logged with buy's calls so every payment is public.
 */
function feeds(cfg: Config, store: Store, chain: ReturnType<typeof createChain>): PaidFeed[] {
  const purchase = async (service: string, url: string): Promise<string | null> => {
    const offer = (await readOffers(url, { method: "GET" })).find((o) => CURRENCIES[o.code].kind === "dollar");
    if (!offer) throw new Error(`${service} asks for nothing the agent pays in`);
    const amount = BigInt(offer.amount);
    if (amount > BigInt(Math.round(cfg.buyMaxUsd * 1e6))) throw new BudgetExceeded(`${service} costs ${amount}, over the per-call cap`);
    const spent = await store.buySpentSince(Date.now() - 86_400_000);
    if (spent + amount > BigInt(Math.round(cfg.buyDailyUsd * 1e6))) throw new BudgetExceeded("daily budget for bought data reached");
    const paid = await payTarget(chain, { url, method: "GET", body: null, contentType: null, offer });
    if (paid.tx || paid.status < 400) await store.addBuyCall({ orderId: null, service, url, amount: offer.amount, token: offer.asset, tx: paid.tx });
    return paid.status === 200 ? paid.body : null;
  };

  const out: PaidFeed[] = [];
  if (cfg.nairaRatesUrl) {
    const url = cfg.nairaRatesUrl;
    out.push({
      fiat: "NGN",
      source: new URL(url).hostname,
      everyMs: cfg.nairaRatesHours * 3_600_000,
      async read() {
        const body = await purchase("naira-rates", url);
        const mid = body ? Number((JSON.parse(body) as { streetMid?: unknown }).streetMid) : NaN;
        return Number.isFinite(mid) && mid > 0 ? mid : null;
      },
    });
  }
  return out;
}

/** An in-process Postgres on disk, for a machine with no database of its own. */
async function pglite(dir: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite(dir);
  return { query: async <T>(text: string, params?: unknown[]) => (await pg.query(text, params as never[])).rows as T[] };
}
