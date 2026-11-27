import { describe, expect, it } from "vitest";
import { createEngine } from "../src/engine.js";
import { applyPayment, CONVERT_ROUTE, convertOrderId, orderIdOf, parseConvert } from "../src/payments.js";
import { price } from "../src/router.js";
import { cfg, fakes, FRIEND, PAYER, units } from "./fakes.js";
import { memoryStore } from "./memory.js";

const quiet = { error: () => {}, warn: () => {}, log: () => {} } as unknown as Console;
const HEADER = "eyJ4NDAyVmVyc2lvbiI6Mn0";

describe("converting in one paid call", () => {
  it("prices a bare request as the smallest example", () => {
    expect(parseConvert({})).toEqual({ from: "USDT", to: "cNGN", amountIn: units("USDT", "5"), recipient: null, minOut: null, partner: null });
  });

  it("reads the conversion, the recipient and the floor from the query", () => {
    const ask = parseConvert({ from: "wARS", to: "wBRL", amount: "50000", recipient: FRIEND, minOut: "150.5", partner: "shop" });
    expect(ask).toEqual({ from: "wARS", to: "wBRL", amountIn: units("wARS", "50000"), recipient: FRIEND, minOut: units("wBRL", "150.5"), partner: "shop" });
  });

  it("refuses what it can't price", () => {
    expect(() => parseConvert({ from: "USDT", to: "USDT" })).toThrow("two different currencies");
    expect(() => parseConvert({ from: "EUR", to: "USDT" })).toThrow("two different currencies");
    expect(() => parseConvert({ from: "USDm", to: "USDT" })).toThrow("can't be paid over x402");
    expect(() => parseConvert({ amount: "five" })).toThrow("amount must be a number");
    expect(() => parseConvert({ amount: "0" })).toThrow("more than zero");
    expect(() => parseConvert({ recipient: "0x123" })).toThrow("wallet address");
    expect(() => parseConvert({ minOut: "-1" })).toThrow("minOut must be a number");
  });

  it("takes the first value when a parameter is repeated", () => {
    expect(parseConvert({ from: ["USDC", "USDT"], to: "wARS", amount: "3" }).from).toBe("USDC");
  });

  it("ties the order to the signed payment, and only on its own route", () => {
    const id = convertOrderId(HEADER);
    expect(id).toMatch(/^0x[0-9a-f]{64}$/);
    expect(convertOrderId(HEADER)).toBe(id);
    expect(convertOrderId(`${HEADER}x`)).not.toBe(id);
    expect(orderIdOf({ path: CONVERT_ROUTE, paymentHeader: HEADER })).toBe(id);
    expect(orderIdOf({ path: CONVERT_ROUTE })).toBeNull();
    const named = `0x${"ab".repeat(32)}`;
    expect(orderIdOf({ path: `/x402/orders/${named}/pay`, paymentHeader: HEADER })).toBe(named);
    expect(orderIdOf(undefined)).toBeNull();
  });

  it("runs the order its payment opened and pays the recipient", async () => {
    const store = await memoryStore();
    const f = fakes();
    const ask = parseConvert({ from: "USDT", to: "cNGN", amount: "5", recipient: FRIEND });
    const p = await price(cfg, f.venues, ask.from, ask.to, ask.amountIn);
    expect(p.amountIn).toBe(ask.amountIn);
    const quote = await store.createQuote({ id: "cq1", from: ask.from, to: ask.to, amountIn: p.amountIn.toString(), estOut: p.estOut.toString(), minOut: p.minOut.toString(), fee: p.fee.toString(), usd: p.usd, route: p.route, partner: null, target: null, expiresAt: Date.now() + 45_000 });
    const id = convertOrderId(HEADER);
    await store.createOrder(quote, id, ask.recipient);

    const settled = { payer: PAYER, currency: ask.from, amount: ask.amountIn.toString(), tx: "0xpaid" };
    expect(await applyPayment(store, await store.order(orderIdOf({ path: CONVERT_ROUTE, paymentHeader: HEADER })!), settled)).toBe("applied");
    expect(await applyPayment(store, await store.order(id), settled)).toBe("duplicate");

    const done = (await createEngine(cfg, store, f.chain, f.venues, quiet).run(id))!;
    expect(done.status).toBe("done");
    expect(f.transfers.at(-1)).toMatchObject({ code: "cNGN", to: FRIEND });
    expect(f.transfers.at(-1)!.amount).toBeGreaterThanOrEqual(p.minOut);
  });

  it("sends back a payment that doesn't match the order it opened", async () => {
    const store = await memoryStore();
    const f = fakes();
    const p = await price(cfg, f.venues, "USDT", "cNGN", units("USDT", "5"));
    const quote = await store.createQuote({ id: "cq2", from: "USDT", to: "cNGN", amountIn: p.amountIn.toString(), estOut: p.estOut.toString(), minOut: p.minOut.toString(), fee: p.fee.toString(), usd: p.usd, route: p.route, partner: null, target: null, expiresAt: Date.now() + 45_000 });
    const order = await store.createOrder(quote, convertOrderId(HEADER), null);
    expect(await applyPayment(store, order, { payer: PAYER, currency: "USDT", amount: units("USDT", "4").toString(), tx: "0xshort" })).toBe("mismatch");
    expect(await applyPayment(store, null, { payer: PAYER, currency: "USDT", amount: units("USDT", "5").toString(), tx: "0xnone" })).toBe("no_order");
  });
});
