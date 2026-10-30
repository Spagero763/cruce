import { parseUnits, type Address, type Hex, type TransactionReceipt } from "viem";
import { NotSent, Reverted, type Chain } from "../src/chain.js";
import { loadConfig } from "../src/config.js";
import { CURRENCIES, type CurrencyCode } from "../src/currencies.js";
import type { Venues as EngineVenues } from "../src/engine.js";
import type { FirmQuote, NoQuote } from "../src/textile.js";
import type { PoolRef } from "../src/types.js";

export const PAYER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
export const FRIEND = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
export const AGENT = "0x242C4917FdaFB48A845BFD4356D81AE45EE6E77e";

export const cfg = loadConfig({
  NETWORK: "mainnet",
  AGENT_PRIVATE_KEY: "0xac0974bec39a17e36ba4a4b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  ATTRIBUTION_TAG: "celo_test",
  WORKER_SECRET: "secret",
});

export const units = (code: CurrencyCode, amount: string) => parseUnits(amount, CURRENCIES[code].decimals);

/** Fixed prices per unit, in the hub's terms: 1 USD = 1650 wARS = 5.36 wBRL = 1380 cNGN. */
export const PER_USD: Record<string, number> = { wARS: 1650, wBRL: 5.36, cNGN: 1380, wCOP: 3150, USDT: 1, USDC: 1, USAT: 1 };

/** Like the real venues, nothing trades local currency against local currency directly. */
const quotable = (a: CurrencyCode, b: CurrencyCode) => CURRENCIES[a].kind === "dollar" || CURRENCIES[b].kind === "dollar";

export function convert(from: CurrencyCode, to: CurrencyCode, amountIn: bigint, haircutBps = 0): bigint {
  const inUnits = Number(amountIn) / 10 ** CURRENCIES[from].decimals;
  const out = (inUnits / PER_USD[from]) * PER_USD[to] * (1 - haircutBps / 10_000);
  return BigInt(Math.floor(out * 10 ** CURRENCIES[to].decimals));
}

interface FakeOpts {
  /** Venue to break: the leg through it fails every time. */
  noTextile?: boolean;
  noUniswap?: boolean;
  textileHaircutBps?: number;
  uniswapHaircutBps?: number;
  /** Sends revert after being broadcast. */
  revertSends?: number;
  transferFails?: boolean;
  notSent?: boolean;
}

/** Venues that quote from the fixed table, and a chain whose receipts deliver exactly what was quoted. */
export function fakes(opts: FakeOpts = {}) {
  const sent: { to: string; what: string; hash: Hex }[] = [];
  const transfers: { code: CurrencyCode; to: string; amount: bigint; hash: Hex }[] = [];
  let n = 0;
  const hash = () => `0x${(++n).toString(16).padStart(64, "0")}` as Hex;
  // What each hash delivers, so received() can answer like the real receipt parser would.
  const delivers = new Map<string, { code: CurrencyCode; amount: bigint; from: string[] }>();
  let pendingDeliver: { code: CurrencyCode; amount: bigint; from: string[] } | null = null;
  let reverts = opts.revertSends ?? 0;

  const textile = {
    indicative: async (sell: Address, buy: Address, amount: bigint) => {
      if (opts.noTextile || !quotable(codeOf(sell), codeOf(buy))) return null;
      return convert(codeOf(sell), codeOf(buy), amount, opts.textileHaircutBps ?? 2);
    },
    firm: async (args: { sellToken: Address; buyToken: Address; sellAmount: bigint }): Promise<FirmQuote | NoQuote> => {
      const from = codeOf(args.sellToken);
      const to = codeOf(args.buyToken);
      if (opts.noTextile || !quotable(from, to)) return { status: "no_quote", reason: "no_makers_online" };
      const buyAmount = convert(from, to, args.sellAmount, opts.textileHaircutBps ?? 2);
      pendingDeliver = { code: to, amount: buyAmount, from: ["0xmaker"] };
      return {
        status: "quoted",
        rfqId: "rfq",
        claimToken: "claim",
        takerPays: args.sellAmount,
        buyAmount,
        feeAmount: 0n,
        spender: "0x0000000000000000000000000000000000000ee1",
        expiresAt: Date.now() + 60_000,
        approval: { to: args.sellToken, data: "0x", value: "0", chainId: 42220 },
        swap: { to: "0x0000000000000000000000000000000000000ee1", data: "0xswap", value: "0", chainId: 42220 },
        makers: ["0x00000000000000000000000000000000000000a1"],
      };
    },
    submit: async () => {},
    cancel: async () => {},
  };

  const uniswap = {
    quote: async (_pool: PoolRef, from: CurrencyCode, to: CurrencyCode, amountIn: bigint) =>
      opts.noUniswap || !quotable(from, to) ? null : convert(from, to, amountIn, opts.uniswapHaircutBps ?? 10),
    build: (pool: PoolRef, from: CurrencyCode, to: CurrencyCode, amountIn: bigint) => {
      pendingDeliver = { code: to, amount: convert(from, to, amountIn, opts.uniswapHaircutBps ?? 10), from: ["0xpool"] };
      return { to: "0x0000000000000000000000000000000000000ee2" as Address, data: "0xuni" as Hex, spender: "0x0000000000000000000000000000000000000ee2" as Address, approval: (pool.kind === "v3" ? "erc20" : "permit2") as "erc20" | "permit2" };
    },
  };

  const receipt = (h: Hex) => ({ transactionHash: h, status: "success", logs: [] }) as unknown as TransactionReceipt;

  const chain = {
    address: AGENT,
    account: { address: AGENT, signTypedData: async () => "0xsig" },
    send: async (tx: { to: Address }, what: string, onHash?: (h: Hex) => Promise<void>) => {
      if (opts.notSent) throw new NotSent("agent wallet is busy");
      const h = hash();
      sent.push({ to: tx.to, what, hash: h });
      if (onHash) await onHash(h);
      if (reverts > 0) {
        reverts--;
        throw new Reverted(h, what);
      }
      if (pendingDeliver) delivers.set(h, pendingDeliver);
      pendingDeliver = null;
      return { hash: h, receipt: receipt(h) };
    },
    transfer: async (code: CurrencyCode, to: Address, amount: bigint, onHash?: (h: Hex) => Promise<void>) => {
      if (opts.transferFails) throw new Error("insufficient funds");
      const h = hash();
      transfers.push({ code, to, amount, hash: h });
      if (onHash) await onHash(h);
      return { hash: h, receipt: receipt(h) };
    },
    received: (r: TransactionReceipt, code: CurrencyCode) => {
      const d = delivers.get(r.transactionHash);
      return d && d.code === code ? { amount: d.amount, from: d.from } : { amount: 0n, from: [] };
    },
    outcome: async (h: Hex) => (delivers.has(h) ? { status: "success" as const, receipt: receipt(h) } : { status: "pending" as const, receipt: null }),
    ensureAllowance: async () => {},
    ensurePermit2: async () => {},
    balance: async () => 0n,
    idle: async () => true,
    transferLanded: async () => "success" as const,
  } as unknown as Chain;

  return { chain, venues: { textile, uniswap } as EngineVenues & { textile: typeof textile; uniswap: typeof uniswap }, sent, transfers, delivers };
}

const codeOf = (address: string): CurrencyCode => {
  const code = (Object.keys(CURRENCIES) as CurrencyCode[]).find((c) => CURRENCIES[c].address.toLowerCase() === address.toLowerCase());
  if (!code) throw new Error(`unknown token ${address}`);
  return code;
};
