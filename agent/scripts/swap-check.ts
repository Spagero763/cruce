// Proves each venue with real money, a dollar or two at a time, from the agent's own wallet.
// Nothing here touches a user. Run it once per venue before the first order ever runs.
//
//   npm run swap-check -w @cruce/agent -- textile USDT wARS 1.5
//   npm run swap-check -w @cruce/agent -- v3 wARS USDT 2500
//   npm run swap-check -w @cruce/agent -- v4 USDC wBRL 1.5
import { formatUnits, parseUnits, type Hex } from "viem";
import { createChain } from "../src/chain.js";
import { loadConfig } from "../src/config.js";
import { CURRENCIES, isCurrency, type CurrencyCode } from "../src/currencies.js";
import { Store } from "../src/db.js";
import { connect } from "../src/pg.js";
import { Textile } from "../src/textile.js";
import { poolsFor, Uniswap, V4_ROUTER } from "../src/uniswap.js";

const [venue, fromArg, toArg, amountArg] = process.argv.slice(2);
if (!["textile", "v3", "v4", "mento"].includes(venue) || !isCurrency(fromArg) || !isCurrency(toArg) || !amountArg) {
  console.error("usage: swap-check <textile|v3|v4|mento> <from> <to> <amount>");
  process.exit(1);
}
const from = fromArg as CurrencyCode;
const to = toArg as CurrencyCode;
const cfg = loadConfig();
// The wallet lease lives in whatever database is at hand; a throwaway one is fine for a check.
const store = new Store(cfg.databaseUrl ? connect(cfg.databaseUrl) : await localDb());
await store.migrate();

async function localDb() {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite();
  return { query: async <T>(text: string, params?: unknown[]) => (await pg.query(text, params as never[])).rows as T[] };
}
const chain = createChain(cfg, store);
const amountIn = parseUnits(amountArg, CURRENCIES[from].decimals);
const fmt = (code: CurrencyCode, v: bigint) => `${formatUnits(v, CURRENCIES[code].decimals)} ${code}`;

const before = await chain.balance(from);
console.log(`agent ${chain.address} holds ${fmt(from, before)}; swapping ${fmt(from, amountIn)} on ${venue}`);
if (before < amountIn) throw new Error("not enough balance for this check");

let hash: Hex | undefined;
const note = async (h: Hex) => {
  hash = h;
  console.log("broadcast", `${cfg.explorer}/tx/${h}`);
};

if (venue === "textile") {
  const textile = new Textile(cfg.textileUrl, cfg.chain.id, cfg.textileApiKey);
  const q = await textile.firm({ sellToken: CURRENCIES[from].address, buyToken: CURRENCIES[to].address, sellAmount: amountIn, taker: chain.account });
  if (q.status !== "quoted") throw new Error(`no quote: ${q.reason}`);
  console.log(`firm quote: pay ${fmt(from, q.takerPays)} get ${fmt(to, q.buyAmount)} via ${q.makers.length} maker(s), spender ${q.spender}, expires in ${Math.round((q.expiresAt - Date.now()) / 1000)}s`);
  await chain.ensureAllowance(from, q.spender, q.takerPays);
  const sent = await chain.send({ to: q.swap.to, data: q.swap.data }, "textile swap", note);
  await textile.submit(q.rfqId, q.claimToken, sent.hash);
  const got = chain.received(sent.receipt, to);
  console.log(`filled: received ${fmt(to, got.amount)} from ${got.from.join(", ")}`);
} else {
  const uniswap = new Uniswap(chain.pub);
  const pool = poolsFor(from, to).find((p) => p.kind === venue);
  if (!pool) throw new Error(`no ${venue} pool for ${from}/${to}`);
  const quoted = await uniswap.quote(pool, from, to, amountIn);
  if (quoted === null) throw new Error("no quote");
  const minOut = (quoted * 9_900n) / 10_000n;
  console.log(`quoted ${fmt(to, quoted)}, sending with a floor of ${fmt(to, minOut)}`);
  const built = uniswap.build(pool, from, to, amountIn, minOut, chain.address, BigInt(Math.floor(Date.now() / 1000) + 300));
  if (built.approval === "erc20") await chain.ensureAllowance(from, built.spender, amountIn);
  else await chain.ensurePermit2(from, V4_ROUTER, amountIn);
  const sent = await chain.send({ to: built.to, data: built.data }, `uniswap ${venue} swap`, note);
  const got = chain.received(sent.receipt, to);
  console.log(`filled: received ${fmt(to, got.amount)} from ${got.from.join(", ")}`);
}
console.log(`tx ${hash}; now holding ${fmt(from, await chain.balance(from))} and ${fmt(to, await chain.balance(to))}`);
process.exit(0);
