import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { authMessage, issueNonce, verifySigned } from "../src/auth.js";
import { applyPayment, orderIdFromPath } from "../src/payments.js";
import { interpolate } from "../src/textile.js";
import { parseNumber } from "../src/rates.js";
import type { Route } from "../src/types.js";
import { PAYER } from "./fakes.js";
import { memoryStore } from "./memory.js";

const signer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const ID = `0x${"cd".repeat(32)}`;
const route: Route = { legs: [{ venue: "textile", from: "wARS", to: "USDT", quotedIn: "1", quotedOut: "1" }], feeLeg: 1, feeToken: "USDT" };
const quote = { id: "q", from: "wARS" as const, to: "USDT" as const, amountIn: "1000", estOut: "1", minOut: "1", fee: "0", usd: "2", route, partner: null, expiresAt: Date.now() + 1000 };

describe("store", () => {
  it("keeps quotes, orders, their history and moves them one step at a time", async () => {
    const s = await memoryStore();
    const q = await s.createQuote(quote);
    const o = await s.createOrder(q, ID, null);
    expect(o.status).toBe("awaiting_payment");
    expect(await s.claimPayment(ID, PAYER, "0xpay")).toBe(true);
    expect(await s.claimPayment(ID, PAYER, "0xpay2")).toBe(false);
    expect(await s.order(ID)).toMatchObject({ status: "paid", payer: PAYER.toLowerCase(), recipient: PAYER.toLowerCase(), paidTx: "0xpay" });
    expect(await s.transition(ID, "paid", "swapping")).toBe(true);
    expect(await s.transition(ID, "paid", "swapping")).toBe(false);
    await s.updateOrder(ID, { route: { ...route, legs: [{ ...route.legs[0], tx: "0xa", out: "5" }] } });
    expect((await s.order(ID))!.route.legs[0].out).toBe("5");
    await s.addEvent(ID, "leg", { i: 0 }, "0xa");
    expect((await s.events(ID))[0]).toMatchObject({ kind: "leg", tx: "0xa", detail: { i: 0 } });
    expect(await s.ordersByWallet(PAYER)).toHaveLength(1);
    expect(await s.ordersByStatus("swapping")).toHaveLength(1);
  });

  it("applies a settled payment once and treats the same tx reported again as one payment", async () => {
    const s = await memoryStore();
    const o = await s.createOrder(await s.createQuote(quote), ID, null);
    const paid = (tx: string) => ({ payer: PAYER, currency: "wARS" as const, amount: "1000", tx });
    expect(await applyPayment(s, o, paid("0xaaa"))).toBe("applied");
    expect(await applyPayment(s, await s.order(ID), paid("0xaaa"))).toBe("duplicate");
    expect(await applyPayment(s, await s.order(ID), paid("0xbbb"))).toBe("already_paid");
    expect(await applyPayment(s, await s.order(ID), { ...paid("0xccc"), amount: "999" })).toBe("mismatch");
    expect(await applyPayment(s, null, paid("0xddd"))).toBe("no_order");
    expect(await s.addOrphan({ orderId: ID, ...paid("0xeee"), reason: "already_paid" })).toBe(true);
    expect(await s.addOrphan({ orderId: ID, ...paid("0xeee"), reason: "already_paid" })).toBe(false);
  });

  it("drops unpaid orders and stale quotes after a while, keeps paid ones", async () => {
    const s = await memoryStore();
    const q = await s.createQuote({ ...quote, expiresAt: Date.now() - 100_000 });
    await s.createOrder(q, ID, null);
    await s.createOrder(q, `0x${"ce".repeat(32)}`, null);
    await s.claimPayment(`0x${"ce".repeat(32)}`, PAYER);
    expect(await s.dropUnpaid(-1)).toBe(1);
    expect(await s.order(ID)).toBeNull();
    expect(await s.order(`0x${"ce".repeat(32)}`)).not.toBeNull();
  });

  it("hands a lease to one holder at a time and only the holder can release it", async () => {
    const s = await memoryStore();
    const a = await s.lock("worker", 60_000);
    expect(a).toBeTruthy();
    expect(await s.lock("worker", 60_000)).toBeNull();
    await s.unlock("worker", "someone-else");
    expect(await s.lock("worker", 60_000)).toBeNull();
    await s.unlock("worker", a!);
    expect(await s.lock("worker", 60_000)).toBeTruthy();
  });

  it("counts activity and partner volume from finished orders only", async () => {
    const s = await memoryStore();
    await s.createPartner({ code: "p-1", address: "0xabc", name: "P", shareBps: 20 });
    const q = await s.createQuote({ ...quote, partner: "p-1" });
    await s.createOrder(q, ID, null);
    await s.claimPayment(ID, PAYER);
    expect((await s.activity()).done).toBe(0);
    await s.updateOrder(ID, { status: "done", outAmount: "1" });
    const a = await s.activity();
    expect(a).toMatchObject({ done: 1, wallets: 1, usd: "2" });
    expect(a.corridors[0]).toMatchObject({ from: "wARS", to: "USDT", count: 1 });
    expect(await s.partnerStats("p-1")).toEqual({ done: 1, usd: "2" });
  });

  it("issues single-use nonces bound to one action", async () => {
    const s = await memoryStore();
    const nonce = await issueNonce(s, signer.address);
    const signature = await signer.signMessage({ message: authMessage("partner", nonce) });
    await expect(verifySigned(s, "other", { address: signer.address, nonce, signature })).rejects.toThrow();
    expect(await verifySigned(s, "partner", { address: signer.address, nonce, signature })).toBe(signer.address);
    await expect(verifySigned(s, "partner", { address: signer.address, nonce, signature })).rejects.toThrow();
  });
});

describe("small pieces", () => {
  it("reads the order id only from a well-formed pay path", () => {
    expect(orderIdFromPath(`/x402/orders/${ID}/pay`)).toBe(ID);
    expect(orderIdFromPath("/x402/orders/nope/pay")).toBeNull();
  });

  it("interpolates a Textile ladder and refuses sizes outside it", () => {
    const ladder = { sellToken: "0x1", buyToken: "0x2", minSell: 100n, maxSell: 1_000n, levels: [{ sellAmount: 100n, buyAmount: 50n }, { sellAmount: 1_000n, buyAmount: 450n }] } as never;
    expect(interpolate(ladder, 100n)).toBe(50n);
    expect(interpolate(ladder, 550n)).toBe(250n);
    expect(interpolate(ladder, 1_000n)).toBe(450n);
    expect(interpolate(ladder, 99n)).toBeNull();
    expect(interpolate(ladder, 1_001n)).toBeNull();
  });

  it("reads numbers the way the boards write them", () => {
    expect(parseNumber("$1.650,50")).toBe(1650.5);
    expect(parseNumber("1,650.50 ARS")).toBe(1650.5);
    expect(parseNumber("₦1,380")).toBe(1380);
    expect(parseNumber("5,36")).toBe(5.36);
    expect(parseNumber("none")).toBeNull();
    expect(parseNumber("0")).toBeNull();
  });
});
