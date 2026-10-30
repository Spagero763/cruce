import { withAttribution } from "@celo/attribution-tags";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  maxUint256,
  parseAbi,
  parseEventLogs,
  parseSignature,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Config } from "./config.js";
import { CURRENCIES, type CurrencyCode } from "./currencies.js";
import type { Store } from "./db.js";
import { PERMIT2 } from "./uniswap.js";

// Fee-abstraction adapter for USD₮, so the agent pays gas without holding CELO.
const USDT_FEE_ADAPTER: Address = "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72";

/** Transaction fields that make gas come out of USD₮ instead of CELO, when configured. */
export const feeFields = (cfg: Pick<Config, "network" | "feeCurrency">) =>
  cfg.network === "mainnet" && cfg.feeCurrency === "USDT" ? { feeCurrency: USDT_FEE_ADAPTER } : {};

export type Chain = ReturnType<typeof createChain>;

/** Thrown before anything reached the network, so the caller can safely try again. */
export class NotSent extends Error {}

/** Thrown once a transaction is mined and failed; the hash is kept for the record. */
export class Reverted extends Error {
  constructor(
    readonly hash: Hex,
    what: string,
  ) {
    super(`${what} reverted: ${hash}`);
  }
}

export type TxOutcome = "success" | "reverted" | "pending";

export interface Authorization {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
}

const EIP3009_ABI = parseAbi([
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
]);
const PERMIT2_ABI = parseAbi([
  "function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
]);
const MAX_UINT160 = (1n << 160n) - 1n;
const FAR_FUTURE = 2n ** 48n - 1n;

export interface Sent {
  hash: Hex;
  receipt: TransactionReceipt;
}

/** The agent's only path to the chain; the wallet is extended with the attribution tag. */
export function createChain(cfg: Config, store: Store) {
  if (!cfg.privateKey) throw new Error("AGENT_PRIVATE_KEY is not set");
  if (cfg.network === "mainnet" && !cfg.attributionTag) {
    throw new Error("ATTRIBUTION_TAG must be set before sending mainnet transactions");
  }
  const account = privateKeyToAccount(cfg.privateKey);
  const transport = http(cfg.rpcUrl);
  const pub = createPublicClient({ chain: cfg.chain, transport });
  const base = createWalletClient({ account, chain: cfg.chain, transport });
  const wallet = cfg.attributionTag ? base.extend(withAttribution(cfg.attributionTag)) : base;
  const fee = feeFields(cfg);

  // Serverless instances share one wallet, so every send holds a lease until its receipt lands.
  // That keeps nonces from colliding when several orders settle at the same moment.
  const lockName = `wallet:${account.address.toLowerCase()}`;

  async function withWallet<T>(fn: () => Promise<T>): Promise<T> {
    const deadline = Date.now() + 120_000;
    let lease: string | null;
    while (!(lease = await store.lock(lockName, 90_000))) {
      if (Date.now() > deadline) throw new NotSent("agent wallet is busy, try again");
      await new Promise((r) => setTimeout(r, 250 + Math.random() * 250));
    }
    try {
      return await fn();
    } finally {
      await store.unlock(lockName, lease);
    }
  }

  /**
   * Sends one transaction. `onHash` runs as soon as the network has it and before the receipt
   * is awaited, so the caller can write the hash down; a crash after that point loses nothing.
   */
  function send(tx: { to: Address; data: Hex; value?: bigint }, what: string, onHash?: (hash: Hex) => Promise<void>): Promise<Sent> {
    return withWallet(async () => {
      const nonce = await pub.getTransactionCount({ address: account.address, blockTag: "pending" });
      const hash = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ?? 0n, ...fee, nonce } as never);
      if (onHash) await onHash(hash);
      const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
      if (receipt.status !== "success") throw new Reverted(hash, what);
      return { hash, receipt };
    });
  }

  const write = (address: Address, abi: unknown, functionName: string, args: readonly unknown[], onHash?: (hash: Hex) => Promise<void>) =>
    send({ to: address, data: encode(abi, functionName, args) }, functionName, onHash);

  const token = (code: CurrencyCode) => CURRENCIES[code].address;

  return {
    address: account.address,
    account,
    pub,
    send,

    balance: (code: CurrencyCode, owner: Address = account.address) =>
      pub.readContract({ address: token(code), abi: erc20Abi, functionName: "balanceOf", args: [owner] }),

    /** Lets `spender` pull `code` from the agent, once, with no ceiling: every later swap skips this. */
    async ensureAllowance(code: CurrencyCode, spender: Address, amount: bigint): Promise<void> {
      const current = await pub.readContract({ address: token(code), abi: erc20Abi, functionName: "allowance", args: [account.address, spender] });
      if (current < amount) await write(token(code), erc20Abi, "approve", [spender, maxUint256]);
    },

    /** The two approvals a Universal Router swap needs: the token to Permit2, then Permit2 to the router. */
    async ensurePermit2(code: CurrencyCode, router: Address, amount: bigint): Promise<void> {
      await this.ensureAllowance(code, PERMIT2, amount);
      const [allowed, expiration] = await pub.readContract({ address: PERMIT2, abi: PERMIT2_ABI, functionName: "allowance", args: [account.address, token(code), router] });
      const expired = BigInt(expiration) !== 0n && BigInt(expiration) < BigInt(Math.floor(Date.now() / 1000) + 3600);
      if (allowed < amount || expired) await write(PERMIT2, PERMIT2_ABI, "approve", [token(code), router, MAX_UINT160, FAR_FUTURE]);
    },

    transfer: (code: CurrencyCode, to: Address, amount: bigint, onHash?: (hash: Hex) => Promise<void>) =>
      write(token(code), erc20Abi, "transfer", [to, amount], onHash),

    /** Moves someone else's dollars on their signed say-so, so a wallet with no CELO can still send. */
    transferWithAuthorization: (code: CurrencyCode, a: Authorization, signature: Hex) => {
      const { r, s, v } = parseSignature(signature);
      return write(token(code), EIP3009_ABI, "transferWithAuthorization", [a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, Number(v ?? 27n), r, s]);
    },

    /** How much of `code` a receipt delivered to the agent, and from whom. */
    received(receipt: TransactionReceipt, code: CurrencyCode) {
      const logs = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs }).filter(
        (l) => l.address.toLowerCase() === token(code).toLowerCase() && l.args.to.toLowerCase() === account.address.toLowerCase(),
      );
      const amount = logs.reduce((sum, l) => sum + l.args.value, 0n);
      const from = [...new Set(logs.map((l) => l.args.from.toLowerCase()))];
      return { amount, from };
    },

    /** Whether a transaction landed, and its receipt when it did. */
    async outcome(hash: Hex): Promise<{ status: TxOutcome; receipt: TransactionReceipt | null }> {
      const receipt = await pub.getTransactionReceipt({ hash }).catch(() => null);
      if (!receipt) return { status: "pending", receipt: null };
      return { status: receipt.status === "success" ? "success" : "reverted", receipt };
    },

    /** Whether a tx someone else broadcast landed, and if so whether it moved `amount` of `token` to the agent. */
    async transferLanded(hash: Hex, code: CurrencyCode, amount: bigint): Promise<TxOutcome> {
      const { status, receipt } = await this.outcome(hash);
      if (status !== "success" || !receipt) return status;
      return this.received(receipt, code).amount >= amount ? "success" : "reverted";
    },

    /** True when nothing the agent sent is still waiting to be mined. */
    async idle() {
      const [mined, pending] = await Promise.all([
        pub.getTransactionCount({ address: account.address, blockTag: "latest" }),
        pub.getTransactionCount({ address: account.address, blockTag: "pending" }),
      ]);
      return mined === pending;
    },
  };
}

import { encodeFunctionData } from "viem";
const encode = (abi: unknown, functionName: string, args: readonly unknown[]) =>
  encodeFunctionData({ abi: abi as never, functionName, args: args as never } as never);
