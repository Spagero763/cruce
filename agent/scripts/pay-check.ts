// Pays a real x402 service through a running Cruce, as an agent holding the "wrong" currency would:
// ask Cruce to price the service in what the payer holds, pay Cruce once, read back the answer.
//
//   LIVE_API=http://localhost:8788 npm run pay-check -w @cruce/agent -- wARS
import { readFileSync } from "node:fs";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { createPublicClient, formatUnits, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { CURRENCIES, isCurrency, type CurrencyCode } from "../src/currencies.js";

const fromArg = process.argv[2] ?? "wARS";
if (!isCurrency(fromArg)) throw new Error("usage: pay-check <currency>");
const from = fromArg as CurrencyCode;
const api = (process.env.LIVE_API ?? "http://localhost:8787").replace(/\/$/, "");
const service = process.env.SERVICE_URL ?? "https://gateway.usebuy.ai/cencori/v1/chat/completions";
const body = JSON.stringify({ model: "maximo-atlas-1.3", max_tokens: 256, messages: [{ role: "user", content: "In one sentence: why does paying in your own currency matter?" }] });
const key = (process.env.LIVE_BUYER_KEY ?? readFileSync(new URL("../data/live-buyer.key", import.meta.url), "utf8")).trim() as Hex;
const payer = privateKeyToAccount(key);
const pub = createPublicClient({ chain: celo, transport: http() });

const post = async <T>(path: string, data: unknown): Promise<T> => {
  const res = await fetch(api + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json as T;
};
const get = async <T>(path: string): Promise<{ status: number; json: T }> => {
  const res = await fetch(api + path);
  return { status: res.status, json: (await res.json()) as T };
};

console.log(`payer ${payer.address} pays ${service} in ${from} through ${api}`);
const { quote, service: svc } = await post<{ quote: { id: string; amountIn: string; display: { in: string; out: string; fee: string }; legs: { venue: string; from: string; to: string }[] }; service: { host: string; currency: string; display: string } }>("/api/pay/quote", {
  url: service,
  method: "POST",
  body,
  contentType: "application/json",
  from,
});
console.log(`${svc.host} asks ${svc.display} ${svc.currency}; Cruce asks ${quote.display.in} ${from} (fee ${quote.display.fee})`);
for (const l of quote.legs) console.log(`   ${l.venue.padEnd(10)} ${l.from} -> ${l.to}`);

const { order, payUrl } = await post<{ order: { id: string; amountIn: string }; payUrl: string }>("/api/orders", { quoteId: quote.id });
const signer = {
  address: payer.address,
  signTypedData: (m: Record<string, unknown>) => payer.signTypedData(m as never),
  readContract: (a: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }) => pub.readContract(a as never),
};
const client = new x402Client();
client.register("eip155:42220", new ExactEvmScheme(signer as never) as never);
client.setSpendControls({ maxAmountPerPayment: false, allowedAssets: [{ network: "eip155:42220", asset: CURRENCIES[from].address, maxAmountPerPayment: order.amountIn }] });
const t0 = Date.now();
const res = await wrapFetchWithPayment(fetch, client)(payUrl.replace(/^https?:\/\/[^/]+/, api), { method: "POST" });
if (!res.ok) throw new Error(`payment failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
console.log(`paid ${formatUnits(BigInt(order.amountIn), CURRENCIES[from].decimals)} ${from}; order ${order.id}`);

for (;;) {
  const { json: o } = await get<{ order: { status: string; legs: { venue: string; from: string; to: string; tx: string | null }[]; paidTx: string | null; payoutTx: string | null; refundTx: string | null; updatedAt: number } }>(`/api/orders/${order.id}`);
  if (["done", "refunded", "attention"].includes(o.order.status)) {
    console.log(`\n${o.order.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log(`paid    ${o.order.paidTx}`);
    for (const l of o.order.legs) console.log(`leg     ${l.venue.padEnd(10)} ${l.from}->${l.to} ${l.tx}`);
    console.log(`service ${o.order.payoutTx}`);
    if (o.order.refundTx) console.log(`change  ${o.order.refundTx}`);
    const r = await get<{ ready: boolean; status?: number; body?: string }>(`/api/orders/${order.id}/result`);
    console.log(`answer  HTTP ${r.json.status}: ${(r.json.body ?? "").slice(0, 400)}`);
    process.exit(o.order.status === "done" ? 0 : 2);
  }
  if (Date.now() - o.order.updatedAt > 40_000) await post(`/api/orders/${order.id}/resume`, {}).catch(() => {});
  await new Promise((r) => setTimeout(r, 2_500));
}
