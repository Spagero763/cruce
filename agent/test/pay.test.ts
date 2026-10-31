import { describe, expect, it } from "vitest";
import { CURRENCIES, type CurrencyCode } from "../src/currencies.js";
import type { Store } from "../src/db.js";
import { createEngine, MAX_ATTEMPTS } from "../src/engine.js";
import { applyPayment } from "../src/payments.js";
import { priceForOutput } from "../src/router.js";
import { NotPaid, pickOffer, readOffers, type Offer, type Paid, type Target } from "../src/target.js";
import { cfg, fakes, PAYER, units } from "./fakes.js";
import { memoryStore } from "./memory.js";

const ID = `0x${"ef".repeat(32)}`;
const quiet = { error: () => {}, warn: () => {}, log: () => {} } as unknown as Console;
const SELLER = "0x00000000000000000000000000000000000000c1";
const ref = { perUsd: { USD: 1, ARS: 1650, BRL: 5.36, NGN: 1380 }, fiats: {}, at: Date.now() };

const offer = (code: CurrencyCode, amount: string): Offer => ({
  version: 2,
  network: "eip155:42220",
  asset: CURRENCIES[code].address,
  code,
  amount: units(code, amount).toString(),
  payTo: SELLER,
});
const target = (o: Offer): Target => ({ url: "https://api.example.com/report", method: "GET", body: null, contentType: null, offer: o });

async function paidPayOrder(store: Store, f: ReturnType<typeof fakes>, from: CurrencyCode, t: Target) {
  const p = await priceForOutput(cfg, f.venues, from, t.offer.code, BigInt(t.offer.amount), ref, { flatUsd: cfg.payFlatUsd, minUsd: cfg.minPayUsd });
  const q = await store.createQuote({ id: "pq1", from, to: t.offer.code, amountIn: p.amountIn.toString(), estOut: p.estOut.toString(), minOut: p.minOut.toString(), fee: p.fee.toString(), usd: p.usd, route: p.route, partner: null, target: t, expiresAt: Date.now() + 45_000 });
  const order = await store.createOrder(q, ID, null);
  expect(await applyPayment(store, order, { payer: PAYER, currency: from, amount: p.amountIn.toString(), tx: "0xpaid" })).toBe("applied");
  return { order: (await store.order(ID))!, priced: p };
}

describe("paying someone else's x402 endpoint", () => {
  it("prices the smallest input whose floor still covers what the service asks", async () => {
    const f = fakes();
    const need = units("USDC", "0.25");
    const p = await priceForOutput(cfg, f.venues, "wARS", "USDC", need, ref, { flatUsd: cfg.payFlatUsd, minUsd: cfg.minPayUsd });
    expect(p.minOut).toBeGreaterThanOrEqual(need);
    // Not wildly over: the input buys less than 10% more than what is needed.
    expect(p.estOut).toBeLessThan((need * 110n) / 100n);
    expect(p.route.flatFee).toBe(String(Math.round(cfg.payFlatUsd * 1e6)));
  });

  it("converts pesos, pays the service in its own asset, returns the change and keeps the answer", async () => {
    const store = await memoryStore();
    const paidTargets: Target[] = [];
    const f = fakes();
    f.venues.pay = async (t: Target): Promise<Paid> => {
      paidTargets.push(t);
      return { status: 200, contentType: "application/json", body: '{"ok":true}', tx: "0xseller" };
    };
    const engine = createEngine(cfg, store, f.chain, f.venues, quiet);
    const t = target(offer("USDC", "0.25"));
    await paidPayOrder(store, f, "wARS", t);
    const done = (await engine.run(ID))!;
    expect(done.status).toBe("done");
    expect(paidTargets).toHaveLength(1);
    expect(done.result).toMatchObject({ state: "paid", status: 200, body: '{"ok":true}' });
    expect(done.payoutTx).toBe("0xseller");
    const out = BigInt(done.route.legs.at(-1)!.out!);
    const feeAtEnd = done.route.feeLeg === done.route.legs.length ? BigInt(done.feeTaken!) : 0n;
    const change = out - feeAtEnd - BigInt(t.offer.amount);
    expect(f.transfers).toEqual(change > 0n ? [expect.objectContaining({ code: "USDC", to: PAYER, amount: change })] : []);
    expect((await store.events(ID)).map((e) => e.kind)).toContain("target_paid");
  });

  it("never pays twice when an instance died mid-payment: a person checks it", async () => {
    const store = await memoryStore();
    const f = fakes();
    let calls = 0;
    f.venues.pay = async () => {
      calls++;
      return { status: 200, contentType: null, body: "", tx: "0xseller" };
    };
    const engine = createEngine(cfg, store, f.chain, f.venues, quiet);
    const t = target(offer("USDT", "1"));
    const { order } = await paidPayOrder(store, f, "wBRL", t);
    // The legs landed and the payment was under way when the process went down.
    const route = structuredClone(order.route);
    for (const [i, leg] of route.legs.entries()) {
      leg.tx = `0x${String(i + 1).padStart(64, "0")}`;
      leg.out = leg.quotedOut;
      f.delivers.set(leg.tx, { code: leg.to, amount: BigInt(leg.quotedOut), from: [] });
    }
    await store.updateOrder(ID, { route, status: "paying_out", result: { state: "sending", at: Date.now() } });
    const after = (await engine.run(ID))!;
    expect(after.status).toBe("attention");
    expect(calls).toBe(0);
  });

  it("retries a refused payment and in the end sends back what the order became", async () => {
    const store = await memoryStore();
    const f = fakes();
    f.venues.pay = async () => {
      throw new NotPaid("the service refused the payment (HTTP 402)");
    };
    const engine = createEngine(cfg, store, f.chain, f.venues, quiet);
    await paidPayOrder(store, f, "wARS", target(offer("USDT", "3")));
    let o = (await engine.run(ID))!;
    for (let i = o.attempts; i < MAX_ATTEMPTS; i++) o = (await engine.run(ID))!;
    expect(o.status).toBe("refunded");
    expect(o.result).toBeNull();
    // The dollars the pesos became, fee included, go back to the payer.
    const sent = f.transfers.reduce((s, t) => s + t.amount, 0n);
    expect(sent).toBe(BigInt(o.route.legs.at(-1)!.out!) + BigInt(o.feeTaken!));
  });
});

describe("reading what a service asks for", () => {
  const usdc = CURRENCIES.USDC.address;
  const wars = CURRENCIES.wARS.address;
  const v2 = (accepts: unknown[]) =>
    (async () =>
      new Response(null, { status: 402, headers: { "payment-required": Buffer.from(JSON.stringify({ x402Version: 2, accepts })).toString("base64") } })) as unknown as typeof fetch;

  it("reads Celo offers in assets Cruce can produce and skips the rest", async () => {
    const offers = await readOffers("https://x.example", {}, v2([
      { scheme: "exact", network: "eip155:42220", asset: usdc, amount: "250000", payTo: SELLER },
      { scheme: "exact", network: "eip155:8453", asset: usdc, amount: "250000", payTo: SELLER },
      { scheme: "exact", network: "eip155:42220", asset: "0x0000000000000000000000000000000000000bad", amount: "1", payTo: SELLER },
    ]));
    expect(offers).toEqual([expect.objectContaining({ code: "USDC", amount: "250000", version: 2 })]);
  });

  it("reads the older body format the buy gateway uses", async () => {
    const v1 = (async () => new Response(JSON.stringify({ x402Version: 1, accepts: [{ scheme: "exact", network: "celo", asset: usdc, maxAmountRequired: "20000", payTo: SELLER }] }), { status: 402 })) as unknown as typeof fetch;
    expect(await readOffers("https://x.example", {}, v1)).toEqual([expect.objectContaining({ code: "USDC", amount: "20000", version: 1, network: "celo" })]);
  });

  it("refuses an address that doesn't ask for payment", async () => {
    const ok = (async () => new Response("hi", { status: 200 })) as unknown as typeof fetch;
    await expect(readOffers("https://x.example", {}, ok)).rejects.toThrow(/did not ask/);
  });

  it("prefers dollars and never picks the payer's own currency", () => {
    const list: Offer[] = [offer("wARS", "1000"), offer("USDC", "1"), offer("USDT", "1")];
    expect(pickOffer(list, "wBRL")?.code).toBe("USDT");
    expect(pickOffer([offer("wARS", "1000")], "wARS")).toBeNull();
    expect(pickOffer([{ ...offer("USDC", "1"), asset: wars, code: "wARS" }], "cNGN")?.code).toBe("wARS");
  });
});
