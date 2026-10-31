import { describe, expect, it } from "vitest";
import { createEngine, MAX_ATTEMPTS } from "../src/engine.js";
import { applyPayment } from "../src/payments.js";
import { price } from "../src/router.js";
import type { CurrencyCode } from "../src/currencies.js";
import type { Store } from "../src/db.js";
import type { Target } from "../src/target.js";
import { cfg, convert, fakes, FRIEND, PAYER, units } from "./fakes.js";
import { memoryStore } from "./memory.js";

const ID = `0x${"ab".repeat(32)}`;
const quiet = { error: () => {}, warn: () => {}, log: () => {} } as unknown as Console;

async function paidOrder(store: Store, f: ReturnType<typeof fakes>, from: CurrencyCode = "wARS", to: CurrencyCode = "wBRL", amount = "165000", recipient: string | null = null, partner: string | null = null, target: Target | null = null) {
  const p = await price(cfg, f.venues, from, to, units(from, amount));
  const quote = await store.createQuote({ id: "q1", from, to, amountIn: p.amountIn.toString(), estOut: p.estOut.toString(), minOut: p.minOut.toString(), fee: p.fee.toString(), usd: p.usd, route: p.route, partner, target, expiresAt: Date.now() + 45_000 });
  const order = await store.createOrder(quote, ID, recipient);
  expect(await applyPayment(store, order, { payer: PAYER, currency: from, amount: p.amountIn.toString(), tx: "0xpaid" })).toBe("applied");
  return (await store.order(ID))!;
}

describe("running an order", () => {
  it("changes pesos into reais through the dollar leg and pays the recipient", async () => {
    const store = await memoryStore();
    const f = fakes();
    const engine = createEngine(cfg, store, f.chain, f.venues, quiet);
    await paidOrder(store, f, "wARS", "wBRL", "165000", FRIEND);
    const done = (await engine.run(ID))!;
    expect(done.status).toBe("done");
    expect(done.route.legs.every((l) => l.tx && l.out)).toBe(true);
    const dollars = convert("wARS", "USDT", units("wARS", "165000"), 2);
    const fee = (dollars * 60n) / 10_000n;
    expect(done.feeTaken).toBe(fee.toString());
    expect(BigInt(done.outAmount!)).toBe(convert("USDT", "wBRL", dollars - fee, 2));
    expect(BigInt(done.outAmount!)).toBeGreaterThanOrEqual(BigInt(done.minOut));
    expect(f.transfers).toEqual([expect.objectContaining({ code: "wBRL", to: FRIEND, amount: BigInt(done.outAmount!) })]);
    expect(done.route.legs[0].counterparties).toContain("0xmaker");
    const kinds = (await store.events(ID)).map((e) => e.kind);
    expect(kinds).toEqual(["paid", "leg", "leg", "paid_out", "done"]);
  });

  it("pays the sender when no recipient was named, and shares the fee with the partner", async () => {
    const store = await memoryStore();
    const f = fakes();
    await store.createPartner({ code: "shop-1", address: "0x00000000000000000000000000000000000000b1", name: "Shop", shareBps: 20 });
    const engine = createEngine(cfg, store, f.chain, f.venues, quiet);
    await paidOrder(store, f, "USDT", "cNGN", "20", null, "shop-1");
    const done = (await engine.run(ID))!;
    expect(done.status).toBe("done");
    expect(done.recipient).toBe(PAYER.toLowerCase());
    const fee = (units("USDT", "20") * 60n) / 10_000n;
    expect(done.feeTaken).toBe(fee.toString());
    expect(f.transfers.map((t) => [t.code, t.to.toLowerCase(), t.amount])).toEqual([
      ["cNGN", PAYER.toLowerCase(), BigInt(done.outAmount!)],
      ["USDT", "0x00000000000000000000000000000000000000b1", (fee * 20n) / 60n],
    ]);
    expect(done.partnerTx).toBeTruthy();
  });

  it("falls back to the other venue when the quoted one has no makers", async () => {
    const store = await memoryStore();
    const priced = fakes();
    const engine = createEngine(cfg, store, priced.chain, priced.venues, quiet);
    await paidOrder(store, priced, "wARS", "USDT", "165000");
    // Makers leave between the quote and the fill.
    priced.venues.textile.firm = async () => ({ status: "no_quote", reason: "no_makers_online" });
    const done = (await engine.run(ID))!;
    expect(done.status).toBe("done");
    expect(priced.sent[0].to).toBe("0x0000000000000000000000000000000000000ee2");
  });

  it("gives up after repeated failures and returns the pesos untouched when nothing was converted", async () => {
    const store = await memoryStore();
    const f = fakes({ noTextile: true, noUniswap: true });
    const engine = createEngine(cfg, store, f.chain, f.venues, quiet);
    const priced = fakes();
    await paidOrder(store, priced, "wARS", "wBRL", "165000");
    for (let i = 1; i < MAX_ATTEMPTS; i++) expect((await engine.run(ID))!.attempts).toBe(i);
    const after = (await engine.run(ID))!;
    expect(after.status).toBe("refunded");
    expect(f.transfers).toEqual([expect.objectContaining({ code: "wARS", to: PAYER, amount: units("wARS", "165000") })]);
    expect(after.route.legs.every((l) => !l.out)).toBe(true);
  });

  it("returns the dollars, fee included, when the second leg can't be filled", async () => {
    const store = await memoryStore();
    const f = fakes();
    const engine = createEngine(cfg, store, f.chain, f.venues, quiet);
    await paidOrder(store, f, "wARS", "wBRL", "165000");
    const firm = f.venues.textile.firm;
    f.venues.textile.firm = async (args) => (args.buyToken.toLowerCase() === "0xd76f5faf6888e24d9f04bf92a0c8b921fe4390e0" ? { status: "no_quote", reason: "no_valid_quote" } : firm(args));
    f.venues.uniswap.quote = async () => null;
    let order = (await engine.run(ID))!;
    expect(order.status).toBe("swapping");
    expect(order.route.legs[0].out).toBeTruthy();
    for (let i = order.attempts; i < MAX_ATTEMPTS; i++) order = (await engine.run(ID))!;
    expect(order.status).toBe("refunded");
    const dollars = BigInt(order.route.legs[0].out!);
    expect(f.transfers).toEqual([expect.objectContaining({ code: "USDT", to: PAYER, amount: dollars })]);
  });

  it("picks an order up after the instance died mid-leg, without sending the leg twice", async () => {
    const store = await memoryStore();
    const f = fakes();
    const engine = createEngine(cfg, store, f.chain, f.venues, quiet);
    const order = await paidOrder(store, f, "wARS", "wBRL", "165000");
    // Pretend the first leg was broadcast and landed, but the process died before writing the result.
    const route = structuredClone(order.route);
    const firstHash = `0x${"1".padStart(64, "0")}` as const;
    route.legs[0].tx = firstHash;
    f.delivers.set(firstHash, { code: "USDT", amount: convert("wARS", "USDT", units("wARS", "165000"), 2), from: ["0xmaker"] });
    await store.updateOrder(ID, { route, status: "swapping" });
    const done = (await engine.run(ID))!;
    expect(done.status).toBe("done");
    expect(done.route.legs[0].tx).toBe(firstHash);
    expect(f.sent).toHaveLength(1);
  });

  it("leaves an order alone while its transaction is still pending", async () => {
    const store = await memoryStore();
    const f = fakes();
    const engine = createEngine(cfg, store, f.chain, f.venues, quiet);
    const order = await paidOrder(store, f, "wARS", "wBRL", "165000");
    const route = structuredClone(order.route);
    route.legs[0].tx = `0x${"9".padStart(64, "0")}`;
    await store.updateOrder(ID, { route, status: "swapping" });
    const same = (await engine.run(ID))!;
    expect(same.status).toBe("swapping");
    expect(same.attempts).toBe(0);
    expect(f.sent).toHaveLength(0);
  });

  it("re-sends a leg whose transaction reverted", async () => {
    const store = await memoryStore();
    const f = fakes({ revertSends: 1 });
    const engine = createEngine(cfg, store, f.chain, f.venues, quiet);
    await paidOrder(store, f, "USDT", "wARS", "20");
    const after = (await engine.run(ID))!;
    expect(after.status).toBe("done");
    expect(f.sent).toHaveLength(2);
  });

  it("never runs the same order twice at once", async () => {
    const store = await memoryStore();
    const f = fakes();
    const engine = createEngine(cfg, store, f.chain, f.venues, quiet);
    await paidOrder(store, f, "USDT", "wARS", "20");
    const [a, b] = await Promise.all([engine.run(ID), engine.run(ID)]);
    expect([a!.status, b!.status]).toContain("done");
    expect(f.transfers).toHaveLength(1);
  });
});

describe("small pieces of the engine", () => {
  it("matches a pool whatever order its fields came back in", async () => {
    const { samePool } = await import("../src/engine.js");
    const a = { kind: "v4" as const, currency0: "0xAa" as `0x${string}`, currency1: "0xbb" as `0x${string}`, fee: 3000, tickSpacing: 30, hooks: "0x00" as `0x${string}` };
    const reordered = JSON.parse(JSON.stringify({ hooks: "0x00", fee: 3000, kind: "v4", currency1: "0xBB", tickSpacing: 30, currency0: "0xaa" }));
    expect(samePool(a, reordered)).toBe(true);
    expect(samePool({ kind: "v3", fee: 100 }, { kind: "v3", fee: 100 })).toBe(true);
    expect(samePool({ kind: "v3", fee: 100 }, { kind: "v3", fee: 500 })).toBe(false);
    expect(samePool(a, undefined)).toBe(false);
  });

  it("moves on to the next venue when one refuses outright", async () => {
    const store = await memoryStore();
    const f = fakes();
    const engine = createEngine(cfg, store, f.chain, f.venues, quiet);
    await paidOrder(store, f, "USDT", "wARS", "20");
    f.venues.textile.firm = async () => {
      throw new Error("textile request: HTTP 400 sellAmount is below the RFQ minimum");
    };
    f.venues.textile.indicative = async () => null;
    const done = (await engine.run(ID))!;
    expect(done.status).toBe("done");
  });
});
