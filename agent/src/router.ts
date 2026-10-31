// Finds the best way from one currency to another across the venues, prices it, and places the fee.
import { formatUnits, parseUnits } from "viem";
import type { Config } from "./config.js";
import { CURRENCIES, HUBS, type CurrencyCode } from "./currencies.js";
import type { Reference } from "./rates.js";
import type { Textile } from "./textile.js";
import { poolsFor, type Uniswap } from "./uniswap.js";
import type { Leg, PoolRef, Route, Venue } from "./types.js";

export interface LegPrice {
  venue: Venue;
  pool?: PoolRef;
  out: bigint;
}

export interface Priced {
  route: Route;
  amountIn: bigint;
  estOut: bigint;
  minOut: bigint;
  fee: bigint;
  /** Dollar value of the order, measured where the fee is taken. */
  usd: string;
}

export class NoRoute extends Error {}

/** Every hop the venues can make between the two currencies, best venue per hop. */
export interface Venues {
  textile: Pick<Textile, "indicative">;
  uniswap: Pick<Uniswap, "quote">;
}

const isDollar = (c: CurrencyCode) => CURRENCIES[c].kind === "dollar";

export function paths(from: CurrencyCode, to: CurrencyCode): CurrencyCode[][] {
  const out: CurrencyCode[][] = [[from, to]];
  for (const h of HUBS) if (h !== from && h !== to) out.push([from, h, to]);
  for (const h1 of HUBS) for (const h2 of HUBS) if (h1 !== h2 && h1 !== from && h2 !== to && h1 !== to && h2 !== from) out.push([from, h1, h2, to]);
  return out;
}

export async function priceLeg(v: Venues, from: CurrencyCode, to: CurrencyCode, amountIn: bigint): Promise<LegPrice | null> {
  const candidates: Promise<LegPrice | null>[] = [
    v.textile.indicative(CURRENCIES[from].address, CURRENCIES[to].address, amountIn).then((out) => (out && out > 0n ? { venue: "textile", out } : null)),
    ...poolsFor(from, to).map((pool) =>
      v.uniswap.quote(pool, from, to, amountIn).then((out) => (out && out > 0n ? { venue: pool.kind === "v3" ? ("uniswap_v3" as const) : ("uniswap_v4" as const), pool, out } : null)),
    ),
  ];
  const priced = (await Promise.all(candidates)).filter((p): p is LegPrice => p !== null);
  return priced.sort((a, b) => (a.out > b.out ? -1 : a.out < b.out ? 1 : 0))[0] ?? null;
}

/** Where along a path the fee comes out: the first dollar amount we hold. */
export function feePoint(path: CurrencyCode[]): { feeLeg: number; feeToken: CurrencyCode } {
  const i = path.findIndex(isDollar);
  if (i === -1) return { feeLeg: path.length - 1, feeToken: path[path.length - 1] };
  return { feeLeg: i, feeToken: path[i] };
}

export interface PriceOpts {
  /** Fixed part of the fee in dollars, charged only where the fee is taken in a dollar token. */
  flatUsd?: number;
  minUsd?: number;
}

const flatUnits = (feeToken: CurrencyCode, usd: number | undefined) =>
  usd && isDollar(feeToken) ? BigInt(Math.round(usd * 10 ** CURRENCIES[feeToken].decimals)) : 0n;

async function pricePath(cfg: Config, v: Venues, path: CurrencyCode[], amountIn: bigint, opts: PriceOpts = {}): Promise<Priced | null> {
  const { feeLeg, feeToken } = feePoint(path);
  const flat = flatUnits(feeToken, opts.flatUsd);
  const legs: Leg[] = [];
  let amount = amountIn;
  let fee = 0n;
  let usdAt = 0n;
  for (let i = 0; i < path.length - 1; i++) {
    if (i === feeLeg) {
      usdAt = amount;
      fee = (amount * BigInt(cfg.feeBps)) / 10_000n + flat;
      if (fee >= amount) return null;
      amount -= fee;
    }
    const price = await priceLeg(v, path[i], path[i + 1], amount);
    if (!price) return null;
    legs.push({ venue: price.venue, from: path[i], to: path[i + 1], pool: price.pool, quotedIn: amount.toString(), quotedOut: price.out.toString() });
    amount = price.out;
  }
  if (feeLeg === path.length - 1) {
    usdAt = amount;
    fee = (amount * BigInt(cfg.feeBps)) / 10_000n + flat;
    if (fee >= amount) return null;
    amount -= fee;
  }
  const estOut = amount;
  const minOut = (estOut * BigInt(10_000 - cfg.slippageBps)) / 10_000n;
  // A path with no dollar hop is valued by what its input would fetch in dollars.
  const usd = isDollar(feeToken) ? usdAt : ((await priceLeg(v, path[0], "USDT", amountIn))?.out ?? null);
  if (usd === null) return null;
  const route: Route = { legs, feeLeg, feeToken, ...(flat > 0n ? { flatFee: flat.toString() } : {}) };
  return { route, amountIn, estOut, minOut, fee, usd: formatUnits(usd, 6) };
}

/**
 * The best priced route for the order, or why there is none. Dollar value is checked against
 * the order limits and the implied rate against the reference, so a broken venue can't quote.
 */
export async function price(cfg: Config, v: Venues, from: CurrencyCode, to: CurrencyCode, amountIn: bigint, ref?: Reference | null, opts: PriceOpts = {}): Promise<Priced> {
  if (from === to) throw new NoRoute("pick two different currencies");
  const priced = (await Promise.all(paths(from, to).map((p) => pricePath(cfg, v, p, amountIn, opts)))).filter((p): p is Priced => p !== null);
  const best = priced.sort((a, b) => (a.estOut > b.estOut ? -1 : a.estOut < b.estOut ? 1 : 0))[0];
  if (!best) throw new NoRoute(`no venue can fill ${CURRENCIES[from].label} to ${CURRENCIES[to].label} at this size right now`);
  const usd = Number(best.usd);
  const minUsd = opts.minUsd ?? cfg.minOrderUsd;
  if (usd < minUsd) throw new NoRoute(`that is under the minimum of ${minUsd} dollars`);
  if (usd > cfg.maxOrderUsd) throw new NoRoute(`that is over the ${cfg.maxOrderUsd} dollar limit per conversion for now`);
  if (ref) {
    const drift = driftBps(best, from, to, ref);
    if (drift !== null && Math.abs(drift) > cfg.maxDriftBps) throw new NoRoute("the venues are pricing far from the market right now, try again in a minute");
  }
  return best;
}

/** How far the quoted rate sits from the reference cross rate, in basis points. Null without a reference. */
export function driftBps(p: Priced, from: CurrencyCode, to: CurrencyCode, ref: Reference): number | null {
  const rf = ref.perUsd[CURRENCIES[from].fiat];
  const rt = ref.perUsd[CURRENCIES[to].fiat];
  if (!rf || !rt) return null;
  const implied = Number(formatUnits(p.estOut + p.fee * (p.route.feeToken === to ? 1n : 0n), CURRENCIES[to].decimals)) / Number(formatUnits(p.amountIn, CURRENCIES[from].decimals));
  const expected = rt / rf;
  return Math.round(((implied - expected) / expected) * 10_000);
}

/**
 * The smallest input that still delivers `need` of `to` at the guaranteed minimum. Starts from
 * the reference rate, then corrects against the real venues until the floor covers what is needed.
 */
export async function priceForOutput(cfg: Config, v: Venues, from: CurrencyCode, to: CurrencyCode, need: bigint, ref: Reference | null, opts: PriceOpts = {}): Promise<Priced> {
  const f = CURRENCIES[from];
  const t = CURRENCIES[to];
  const rf = ref?.perUsd[f.fiat] ?? (f.kind === "dollar" ? 1 : null);
  const rt = ref?.perUsd[t.fiat] ?? (t.kind === "dollar" ? 1 : null);
  const needUnits = Number(formatUnits(need, t.decimals));
  let guess = rf && rt ? (needUnits / rt) * rf : needUnits;
  guess = guess * (1 + (cfg.feeBps + cfg.slippageBps) / 10_000) * 1.01 + (opts.flatUsd ?? 0) * (rf ?? 1);
  let amountIn = parseUnits(guess.toFixed(Math.min(f.decimals, 12)), f.decimals);
  for (let i = 0; i < 5; i++) {
    const p = await price(cfg, v, from, to, amountIn, ref, opts);
    if (p.minOut >= need) return p;
    // Scale by the shortfall, with a little headroom so the next try lands above the floor.
    amountIn = (amountIn * need * 1_003n) / (p.minOut * 1_000n) + 1n;
  }
  throw new NoRoute("the venues moved while pricing, try again");
}
