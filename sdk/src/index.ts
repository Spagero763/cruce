// Cruce in one import: quote a conversion, pay it over x402, follow it to the end.
// Works in Node and the browser with any viem wallet client.
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import type { Address, PublicClient, WalletClient } from "viem";

export type Code = "wARS" | "wBRL" | "wCOP" | "wMXN" | "wCLP" | "wPEN" | "cNGN" | "USAT" | "USDT" | "USDC";

export interface Quote {
  id: string;
  from: Code;
  to: Code;
  /** Atomic units of the input token: what the payer signs for. */
  amountIn: string;
  /** Atomic units of the output token: the estimate and the floor the agent guarantees. */
  estOut: string;
  minOut: string;
  fee: string;
  feeToken: Code;
  usd: string;
  display: { in: string; out: string; min: string; fee: string };
  legs: { venue: string; from: Code; to: Code }[];
  partner: string | null;
  expiresAt: number;
}

export interface Compare {
  rate: number;
  official: { rate: number; out: number } | null;
  street: { rate: number; out: number } | null;
}

export type OrderStatus = "awaiting_payment" | "paid" | "swapping" | "paying_out" | "done" | "refunding" | "refunded" | "attention";

export interface Order {
  id: `0x${string}`;
  from: Code;
  to: Code;
  amountIn: string;
  estOut: string;
  minOut: string;
  out: string | null;
  fee: string;
  feeToken: Code;
  usd: string;
  display: { in: string; out: string; min: string };
  legs: { venue: string; from: Code; to: Code; tx: string | null; out: string | null; counterparties: string[] }[];
  payer: string | null;
  recipient: string | null;
  partner: string | null;
  status: OrderStatus;
  paidTx: string | null;
  payoutTx: string | null;
  refundTx: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Config {
  chainId: number;
  explorer: string;
  agent: Address;
  currencies: { code: Code; label: string; fiat: string; address: Address; decimals: number; method: "eip3009" | "permit2"; enabled: boolean }[];
  limits: { minUsd: number; maxUsd: number; feeBps: number; partnerBps: number; quoteSeconds: number; slippageBps: number };
}

export class CruceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const TERMINAL = new Set<OrderStatus>(["done", "refunded", "attention"]);

export class Cruce {
  private readonly base: string;
  private readonly partner: string | null;
  private config: Promise<Config> | null = null;

  constructor(opts: { partner?: string | null; baseUrl?: string } = {}) {
    this.base = (opts.baseUrl ?? "https://cruce.vercel.app").replace(/\/$/, "");
    this.partner = opts.partner ?? null;
  }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(this.base + path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new CruceError(res.status, body.error ?? `request failed (${res.status})`);
    return body as T;
  }

  /** Currencies, limits and the agent's address. */
  getConfig(): Promise<Config> {
    return (this.config ??= this.req<Config>("/api/config"));
  }

  /** Prices `amount` of `from` (a decimal string, e.g. "50000") into `to`. Holds for about 45 seconds. */
  async quote(args: { from: Code; to: Code; amount: string }): Promise<Quote & { compare: Compare | null }> {
    const q = new URLSearchParams({ from: args.from, to: args.to, amount: args.amount, ...(this.partner ? { partner: this.partner } : {}) });
    const { quote, compare } = await this.req<{ quote: Quote; compare: Compare | null }>(`/api/quote?${q}`);
    return { ...quote, compare };
  }

  /** Turns a quote into an order the payer can settle. */
  async createOrder(quote: Pick<Quote, "id">, recipient?: Address): Promise<{ order: Order; payUrl: string; expiresAt: number }> {
    return this.req("/api/orders", { method: "POST", body: JSON.stringify({ quoteId: quote.id, recipient }) });
  }

  /**
   * Creates the order and pays it in one go: one EIP-712 signature from `wallet`, settled by the
   * facilitator, no gas. Resolves once the agent has run the order (usually done, sometimes still
   * in flight when a leg is slow; `wait` finishes the job).
   */
  async pay(quote: Pick<Quote, "id" | "from" | "amountIn">, opts: { wallet: WalletClient; pub?: PublicClient; recipient?: Address }): Promise<Order> {
    const address = opts.wallet.account?.address;
    if (!address) throw new Error("the wallet client needs an account");
    const [config, { order, payUrl }] = await Promise.all([this.getConfig(), this.createOrder(quote, opts.recipient)]);
    const currency = config.currencies.find((c) => c.code === order.from);
    if (!currency) throw new Error(`unknown currency ${order.from}`);

    const signer = {
      address,
      signTypedData: (m: { domain: Record<string, unknown>; types: Record<string, unknown>; primaryType: string; message: Record<string, unknown> }) =>
        opts.wallet.signTypedData({ account: opts.wallet.account!, ...m } as never),
      readContract: (a: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }) => {
        if (!opts.pub) throw new Error("a public client is needed to read Permit2 state for this token");
        return opts.pub.readContract(a as never);
      },
    };
    const network = `eip155:${config.chainId}` as const;
    const client = new x402Client();
    client.register(network, new ExactEvmScheme(signer as never) as never);
    client.setSpendControls({ maxAmountPerPayment: false, allowedAssets: [{ network, asset: currency.address, maxAmountPerPayment: order.amountIn }] });

    const res = await wrapFetchWithPayment(fetch, client)(payUrl, { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new CruceError(res.status, body.error ?? `payment failed (${res.status})`);
    return this.order(order.id);
  }

  async order(id: string): Promise<Order> {
    const { order } = await this.req<{ order: Order }>(`/api/orders/${id}`);
    return order;
  }

  /** Polls until the order is done, refunded or flagged. */
  async wait(id: string, opts: { everyMs?: number; timeoutMs?: number } = {}): Promise<Order> {
    const until = Date.now() + (opts.timeoutMs ?? 5 * 60_000);
    for (;;) {
      const order = await this.order(id);
      if (TERMINAL.has(order.status)) return order;
      if (Date.now() > until) return order;
      if (Date.now() - order.updatedAt > 30_000) await this.req(`/api/orders/${id}/resume`, { method: "POST" }).catch(() => {});
      await new Promise((r) => setTimeout(r, opts.everyMs ?? 2_500));
    }
  }

  /** A link to the site with the conversion prefilled and your partner code attached. */
  link(args: { from: Code; to: Code; amount?: string }): string {
    const q = new URLSearchParams({ from: args.from, to: args.to, ...(args.amount ? { amount: args.amount } : {}), ...(this.partner ? { ref: this.partner } : {}) });
    return `${this.base}/?${q}`;
  }
}
