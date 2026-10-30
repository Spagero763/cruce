// Read-only look at what the venues quote right now for every enabled pair, and the routes
// the agent would pick. Runs against mainnet with no key and no wallet.
import { createPublicClient, formatUnits, http, parseUnits } from "viem";
import { celo } from "viem/chains";
import { loadConfig } from "../src/config.js";
import { CURRENCIES, ENABLED, type CurrencyCode } from "../src/currencies.js";
import { price, priceLeg } from "../src/router.js";
import { Textile } from "../src/textile.js";
import { Uniswap } from "../src/uniswap.js";

const cfg = loadConfig({ NETWORK: "mainnet" });
const pub = createPublicClient({ chain: celo, transport: http(cfg.rpcUrl) });
const venues = { textile: new Textile(cfg.textileUrl, celo.id), uniswap: new Uniswap(pub) };

const sample: Record<string, string> = { wARS: "33000", wBRL: "110", wCOP: "80000", cNGN: "28000", USDT: "20", USDC: "20", USAT: "20" };
const fmt = (code: CurrencyCode, v: bigint) => `${Number(formatUnits(v, CURRENCIES[code].decimals)).toLocaleString("en-US", { maximumFractionDigits: 4 })} ${code}`;

console.log("hops, best venue each (about 20 dollars):");
for (const from of ENABLED) {
  for (const to of ENABLED) {
    if (from === to) continue;
    const amount = parseUnits(sample[from], CURRENCIES[from].decimals);
    const p = await priceLeg(venues, from, to, amount);
    if (p) console.log(`  ${from.padEnd(5)} -> ${to.padEnd(5)} ${p.venue.padEnd(10)} ${fmt(from, amount)} -> ${fmt(to, p.out)}`);
  }
}

console.log("\nroutes:");
for (const [from, to] of [["wARS", "wBRL"], ["wBRL", "wARS"], ["cNGN", "wARS"], ["wARS", "cNGN"], ["USDT", "wARS"], ["USAT", "cNGN"], ["wBRL", "cNGN"], ["USDC", "wBRL"]] as [CurrencyCode, CurrencyCode][]) {
  const amount = parseUnits(sample[from], CURRENCIES[from].decimals);
  try {
    const p = await price(cfg, venues, from, to, amount);
    console.log(`  ${fmt(from, amount)} -> ${fmt(to, p.estOut)} (min ${fmt(to, p.minOut)}, fee ${fmt(p.route.feeToken, p.fee)}, $${p.usd})`);
    for (const l of p.route.legs) console.log(`      ${l.venue.padEnd(10)} ${fmt(l.from, BigInt(l.quotedIn))} -> ${fmt(l.to, BigInt(l.quotedOut))}`);
  } catch (err) {
    console.log(`  ${from} -> ${to}: ${(err as Error).message}`);
  }
}
