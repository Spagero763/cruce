import { describe, expect, it } from "vitest";
import type { Buy } from "../src/buy.js";
import { createRates, type PaidFeed } from "../src/rates.js";
import { memoryStore } from "./memory.js";

const quiet = { error: () => {}, warn: () => {}, log: () => {} } as unknown as Console;
const noBrowser = { rentBrowser: async () => { throw new Error("no browser in tests"); } } as unknown as Buy;

async function boardsFresh(store: Awaited<ReturnType<typeof memoryStore>>) {
  await store.setRate("street:ARS", { value: 1650, source: "test" });
  await store.setRate("street:BRL", { value: 5.4, source: "test" });
}

describe("street rates bought from another agent", () => {
  it("buys a feed when its rate is missing and stores it as the street rate", async () => {
    const store = await memoryStore();
    await boardsFresh(store);
    let calls = 0;
    const feed: PaidFeed = { fiat: "NGN", source: "naira", everyMs: 4 * 3_600_000, read: async () => (calls++, 1379.72) };
    const rates = createRates(store, noBrowser, fetch, quiet, [feed]);
    expect(await rates.refreshStreet()).toBe(1);
    expect(calls).toBe(1);
    expect((await store.getRate<{ value: number; source: string }>("street:NGN"))?.value).toEqual({ value: 1379.72, source: "naira" });
  });

  it("doesn't pay again while the last rate is fresh", async () => {
    const store = await memoryStore();
    await boardsFresh(store);
    await store.setRate("street:NGN", { value: 1380, source: "naira" });
    let calls = 0;
    const rates = createRates(store, noBrowser, fetch, quiet, [{ fiat: "NGN", source: "naira", everyMs: 3_600_000, read: async () => (calls++, 1390) }]);
    expect(await rates.refreshStreet()).toBe(0);
    expect(calls).toBe(0);
  });

  it("keeps the old rate when the feed fails or answers nonsense", async () => {
    const store = await memoryStore();
    await boardsFresh(store);
    const broken: PaidFeed[] = [
      { fiat: "NGN", source: "naira", everyMs: 0, read: async () => { throw new Error("402"); } },
      { fiat: "IDR", source: "idr", everyMs: 0, read: async () => -5 },
    ];
    const rates = createRates(store, noBrowser, fetch, quiet, broken);
    expect(await rates.refreshStreet()).toBe(0);
    expect(await store.getRate("street:NGN")).toBeNull();
    expect(await store.getRate("street:IDR")).toBeNull();
  });
});
