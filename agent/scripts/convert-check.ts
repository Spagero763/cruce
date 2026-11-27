// Converts in one paid call through a running Cruce, as an agent that has never used it would:
// read the price off the 402, sign once, follow the order to the end.
//
//   LIVE_API=http://localhost:8788 npm run convert-check -w @cruce/agent -- USDT cNGN 2
import { readFileSync } from "node:fs";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { createPublicClient, formatUnits, http, parseUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { CURRENCIES, isCurrency } from "../src/currencies.js";

const [from, to, amount = "2", recipient] = process.argv.slice(2);
if (!isCurrency(from) || !isCurrency(to)) throw new Error("usage: convert-check <from> <to> [amount] [recipient]");
const api = (process.env.LIVE_API ?? "http://localhost:8787").replace(/\/$/, "");
const key = (process.env.LIVE_BUYER_KEY ?? readFileSync(new URL("../data/live-buyer.key", import.meta.url), "utf8")).trim() as Hex;
const payer = privateKeyToAccount(key);
const pub = createPublicClient({ chain: celo, transport: http() });

const quote = (await (await fetch(`${api}/api/quote?${new URLSearchParams({ from, to, amount })}`)).json()) as { quote?: { display: { out: string; min: string } }; error?: string };
if (!quote.quote) throw new Error(`no quote: ${quote.error}`);
console.log(`payer ${payer.address} changes ${amount} ${from} for about ${quote.quote.display.out} ${to} through ${api}`);

const signer = {
  address: payer.address,
  signTypedData: (m: Record<string, unknown>) => payer.signTypedData(m as never),
  readContract: (a: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }) => pub.readContract(a as never),
};
const client = new x402Client();
client.register("eip155:42220", new ExactEvmScheme(signer as never) as never);
client.setSpendControls({ maxAmountPerPayment: false, allowedAssets: [{ network: "eip155:42220", asset: CURRENCIES[from].address, maxAmountPerPayment: parseUnits(amount, CURRENCIES[from].decimals).toString() }] });

const url = `${api}/x402/convert?${new URLSearchParams({ from, to, amount, minOut: quote.quote.display.min, ...(recipient ? { recipient } : {}) })}`;
const t0 = Date.now();
const res = await wrapFetchWithPayment(fetch, client)(url, { method: "POST" });
if (!res.ok) throw new Error(`not converted: ${res.status} ${(await res.text()).slice(0, 300)}`);
const { order } = (await res.json()) as { order: { id: string } };
console.log(`paid; order ${order.id}`);

for (;;) {
  const { order: o } = (await (await fetch(`${api}/api/orders/${order.id}`)).json()) as { order: { status: string; out: string | null; legs: { venue: string; from: string; to: string; tx: string | null }[]; paidTx: string | null; payoutTx: string | null; refundTx: string | null; updatedAt: number } };
  if (["done", "refunded", "attention"].includes(o.status)) {
    console.log(`\n${o.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log(`paid    ${o.paidTx}`);
    for (const l of o.legs) console.log(`leg     ${l.venue.padEnd(10)} ${l.from}->${l.to} ${l.tx}`);
    if (o.payoutTx) console.log(`payout  ${o.payoutTx}  ${o.out ? formatUnits(BigInt(o.out), CURRENCIES[to].decimals) : ""} ${to}`);
    if (o.refundTx) console.log(`refund  ${o.refundTx}`);
    process.exit(o.status === "done" ? 0 : 2);
  }
  if (Date.now() - o.updatedAt > 40_000) await fetch(`${api}/api/orders/${order.id}/resume`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2_500));
}
