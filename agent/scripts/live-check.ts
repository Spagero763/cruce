// One real conversion through a running API, paid by a test wallet the way a person would pay:
// quote, order, one x402 signature, then the order followed to the end.
//
//   LIVE_API=http://localhost:8788 npm run live-check -w @cruce/agent -- USDT wARS 1
import { readFileSync } from "node:fs";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { createPublicClient, formatUnits, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { CURRENCIES, isCurrency, type CurrencyCode } from "../src/currencies.js";

const [fromArg, toArg, amount, recipientArg] = process.argv.slice(2);
if (!isCurrency(fromArg) || !isCurrency(toArg) || !amount) {
  console.error("usage: live-check <from> <to> <amount> [recipient]");
  process.exit(1);
}
const from = fromArg as CurrencyCode;
const to = toArg as CurrencyCode;
const api = (process.env.LIVE_API ?? "http://localhost:8787").replace(/\/$/, "");
const key = (process.env.LIVE_BUYER_KEY ?? readFileSync(new URL("../data/live-buyer.key", import.meta.url), "utf8")).trim() as Hex;
const payer = privateKeyToAccount(key);
const pub = createPublicClient({ chain: celo, transport: http() });
const fmt = (code: CurrencyCode, v: string | bigint) => `${formatUnits(BigInt(v), CURRENCIES[code].decimals)} ${code}`;

const get = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(api + path, { ...init, headers: { "content-type": "application/json" } });
  const body = await res.json();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body as T;
};

console.log(`payer ${payer.address} against ${api}`);
const { quote, compare } = await get<{ quote: { id: string; display: { in: string; out: string; min: string; fee: string }; legs: { venue: string; from: string; to: string }[]; usd: string }; compare: unknown }>(
  `/api/quote?from=${from}&to=${to}&amount=${amount}`,
);
console.log(`quote ${quote.id}: ${quote.display.in} ${from} -> ${quote.display.out} ${to} (min ${quote.display.min}, fee ${quote.display.fee}, $${quote.usd})`);
for (const l of quote.legs) console.log(`   ${l.venue.padEnd(10)} ${l.from} -> ${l.to}`);
console.log("compare", JSON.stringify(compare));

const { order, payUrl } = await get<{ order: { id: string; amountIn: string }; payUrl: string }>("/api/orders", {
  method: "POST",
  body: JSON.stringify({ quoteId: quote.id, recipient: recipientArg }),
});
const url = payUrl.replace(/^https?:\/\/[^/]+/, api);
console.log(`order ${order.id}; paying at ${url}`);

const signer = {
  address: payer.address,
  signTypedData: (m: { domain: Record<string, unknown>; types: Record<string, unknown>; primaryType: string; message: Record<string, unknown> }) => payer.signTypedData(m as never),
  readContract: (a: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }) => pub.readContract(a as never),
};
const client = new x402Client();
client.register("eip155:42220", new ExactEvmScheme(signer as never) as never);
client.setSpendControls({ maxAmountPerPayment: false, allowedAssets: [{ network: "eip155:42220", asset: CURRENCIES[from].address, maxAmountPerPayment: order.amountIn }] });

const t0 = Date.now();
const res = await wrapFetchWithPayment(fetch, client)(url, { method: "POST" });
const body = (await res.json().catch(() => ({}))) as { error?: string; order?: { status: string } };
if (!res.ok) throw new Error(`payment failed: ${res.status} ${body.error ?? ""}`);
console.log(`paid; agent answered after ${((Date.now() - t0) / 1000).toFixed(1)}s with status ${body.order?.status}`);

for (;;) {
  const { order: o } = await get<{ order: { status: string; out: string | null; legs: { venue: string; from: string; to: string; tx: string | null; out: string | null; counterparties: string[] }[]; paidTx: string | null; payoutTx: string | null; refundTx: string | null; updatedAt: number } }>(`/api/orders/${order.id}`);
  if (["done", "refunded", "attention"].includes(o.status)) {
    console.log(`\n${o.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log(`paid   ${o.paidTx}`);
    for (const l of o.legs) console.log(`leg    ${l.venue.padEnd(10)} ${l.from}->${l.to} ${l.out ? fmt(l.to as CurrencyCode, l.out) : "-"} ${l.tx} (${l.counterparties.length} counterparties)`);
    console.log(`payout ${o.payoutTx} ${o.out ? fmt(to, o.out) : ""}`);
    if (o.refundTx) console.log(`refund ${o.refundTx}`);
    process.exit(o.status === "done" ? 0 : 2);
  }
  if (Date.now() - o.updatedAt > 40_000) await get(`/api/orders/${order.id}/resume`, { method: "POST" }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2_500));
}
