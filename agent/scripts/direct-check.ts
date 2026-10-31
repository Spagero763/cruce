// Pays an order with a plain transfer carrying the order id, the way the site does for currencies
// Celo's x402 facilitator doesn't settle, then follows the order to the end.
//
//   LIVE_API=http://localhost:8788 npm run direct-check -w @cruce/agent -- USDm USDT 0.049
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, http, parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { feeFields } from "../src/chain.js";
import { CURRENCIES, isCurrency, type CurrencyCode } from "../src/currencies.js";

const [fromArg, toArg, amount] = process.argv.slice(2);
if (!isCurrency(fromArg) || !isCurrency(toArg) || !amount) throw new Error("usage: direct-check <from> <to> <amount>");
const from = fromArg as CurrencyCode;
const api = (process.env.LIVE_API ?? "http://localhost:8787").replace(/\/$/, "");
const key = (process.env.LIVE_BUYER_KEY ?? readFileSync(new URL("../data/live-buyer.key", import.meta.url), "utf8")).trim() as Hex;
const payer = privateKeyToAccount(key);
const pub = createPublicClient({ chain: celo, transport: http() });
const wallet = createWalletClient({ account: payer, chain: celo, transport: http() });
const json = async (path: string, init?: RequestInit) => {
  const res = await fetch(api + path, { ...init, headers: { "content-type": "application/json" } });
  return { status: res.status, body: (await res.json()) as any };
};

const cfg = (await json("/api/config")).body;
const { body: q } = await json(`/api/quote?from=${from}&to=${toArg}&amount=${amount}`);
if (!q.quote) throw new Error(JSON.stringify(q));
console.log(`quote: ${q.quote.display.in} ${from} -> ${q.quote.display.out} ${toArg}`);
const { body: o } = await json("/api/orders", { method: "POST", body: JSON.stringify({ quoteId: q.quote.id }) });
const order = o.order;
const data = (encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [cfg.agent, BigInt(order.amountIn)] }) + order.id.slice(2)) as Hex;
const hash = await wallet.sendTransaction({ to: CURRENCIES[from].address, data, ...feeFields({ network: "mainnet", feeCurrency: "USDT" }) } as never);
console.log("transfer", hash);
await pub.waitForTransactionReceipt({ hash });
const t0 = Date.now();
for (let i = 0; i < 30; i++) {
  const r = await json(`/api/orders/${order.id}/paid`, { method: "POST", body: JSON.stringify({ tx: hash }) });
  if (r.status === 202) { await new Promise((s) => setTimeout(s, 2000)); continue; }
  if (r.status !== 200) throw new Error(`${r.status} ${JSON.stringify(r.body)}`);
  const final = r.body.order;
  console.log(`${final.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  for (const l of final.legs) console.log(`leg    ${l.venue} ${l.from}->${l.to} ${l.tx}`);
  console.log(`payout ${final.payoutTx} ${final.display.out} ${final.to}`);
  process.exit(final.status === "done" ? 0 : 2);
}
