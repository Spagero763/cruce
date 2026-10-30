import { describe, expect, it } from "vitest";
import { driftBps, feePoint, paths, price } from "../src/router.js";
import { cfg, convert, fakes, units } from "./fakes.js";

describe("routing", () => {
  it("lists the direct hop and every hop through the hubs", () => {
    expect(paths("wARS", "wBRL")).toEqual([
      ["wARS", "wBRL"],
      ["wARS", "USDT", "wBRL"],
      ["wARS", "USDC", "wBRL"],
      ["wARS", "USDT", "USDC", "wBRL"],
      ["wARS", "USDC", "USDT", "wBRL"],
    ]);
    expect(paths("USDT", "wARS")).toEqual([
      ["USDT", "wARS"],
      ["USDT", "USDC", "wARS"],
    ]);
  });

  it("takes the fee from the first dollars it holds", () => {
    expect(feePoint(["wARS", "USDT", "wBRL"])).toEqual({ feeLeg: 1, feeToken: "USDT" });
    expect(feePoint(["USDT", "wARS"])).toEqual({ feeLeg: 0, feeToken: "USDT" });
    expect(feePoint(["wARS", "USDT"])).toEqual({ feeLeg: 1, feeToken: "USDT" });
    expect(feePoint(["wARS", "wBRL"])).toEqual({ feeLeg: 1, feeToken: "wBRL" });
  });

  it("prices pesos to reais through the dollar leg, fee off the dollars, with a floor under the estimate", async () => {
    const { venues } = fakes();
    const amountIn = units("wARS", "165000");
    const p = await price(cfg, venues, "wARS", "wBRL", amountIn);
    expect(p.route.legs.map((l) => `${l.from}>${l.to}`)).toEqual(["wARS>USDT", "USDT>wBRL"]);
    expect(p.route.feeToken).toBe("USDT");
    expect(p.usd).toBe("99.98");
    const dollars = convert("wARS", "USDT", amountIn, 2);
    expect(p.fee).toBe((dollars * 60n) / 10_000n);
    expect(p.estOut).toBe(convert("USDT", "wBRL", dollars - p.fee, 2));
    expect(p.minOut).toBe((p.estOut * 9_950n) / 10_000n);
  });

  it("prefers the venue that returns more", async () => {
    const better = fakes({ textileHaircutBps: 50, uniswapHaircutBps: 5 });
    const p = await price(cfg, better.venues, "wARS", "USDT", units("wARS", "16500"));
    expect(p.route.legs[0].venue).toBe("uniswap_v3");
    const other = fakes({ textileHaircutBps: 1, uniswapHaircutBps: 30 });
    const q = await price(cfg, other.venues, "wARS", "USDT", units("wARS", "16500"));
    expect(q.route.legs[0].venue).toBe("textile");
  });

  it("refuses sizes outside the limits and pairs nobody fills", async () => {
    const { venues } = fakes();
    await expect(price(cfg, venues, "wARS", "wBRL", units("wARS", "1000"))).rejects.toThrow(/minimum/);
    await expect(price(cfg, venues, "wARS", "wBRL", units("wARS", "1000000"))).rejects.toThrow(/limit/);
    await expect(price(cfg, venues, "wARS", "wARS", units("wARS", "16500"))).rejects.toThrow(/different/);
    const dead = fakes({ noTextile: true, noUniswap: true });
    await expect(price(cfg, dead.venues, "wARS", "wBRL", units("wARS", "165000"))).rejects.toThrow(/no venue/);
  });

  it("refuses a quote that sits far from the reference and measures the drift", async () => {
    const { venues } = fakes();
    const ref = { perUsd: { ARS: 1650, BRL: 5.36 }, fiats: {}, at: Date.now() };
    const p = await price(cfg, venues, "wARS", "wBRL", units("wARS", "165000"), ref);
    expect(Math.abs(driftBps(p, "wARS", "wBRL", ref)!)).toBeLessThan(80);
    const off = { perUsd: { ARS: 1200, BRL: 5.36 }, fiats: {}, at: Date.now() };
    await expect(price(cfg, venues, "wARS", "wBRL", units("wARS", "165000"), off)).rejects.toThrow(/far from the market/);
  });
});
