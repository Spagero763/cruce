// Textile FX: request-for-quote venue where makers quote local currency against dollars.
// Indicative prices come from a free ladder; a firm quote binds signed maker orders to our
// wallet for a minute and comes with the exact transactions to broadcast.
import { randomBytes } from "node:crypto";
import { toHex, type Address, type Hex, type LocalAccount } from "viem";

export interface Level {
  sellAmount: bigint;
  buyAmount: bigint;
}

export interface Ladder {
  sellToken: Address;
  buyToken: Address;
  minSell: bigint;
  maxSell: bigint;
  levels: Level[];
}

export interface Unsigned {
  to: Address;
  data: Hex;
  value: string;
  chainId: number;
}

export interface FirmQuote {
  status: "quoted";
  rfqId: string;
  claimToken: string;
  takerPays: bigint;
  buyAmount: bigint;
  feeAmount: bigint;
  spender: Address;
  expiresAt: number;
  approval: Unsigned;
  swap: Unsigned;
  makers: Address[];
}

export interface NoQuote {
  status: "no_quote";
  reason: string;
  available?: bigint;
  retryAfterMs?: number;
}

/** The wallet that settles: it signs the proof of control and later the swap itself. */
export type TakerSigner = Pick<LocalAccount, "address" | "signTypedData">;

const TAKER_CONTROL = {
  TakerControl: [
    { name: "taker", type: "address" },
    { name: "chainId", type: "uint256" },
    { name: "nonce", type: "bytes32" },
    { name: "issuedAt", type: "uint256" },
  ],
};

const key = (sell: string, buy: string) => `${sell.toLowerCase()}>${buy.toLowerCase()}`;

export class Textile {
  private cache: { at: number; map: Map<string, Ladder> } | null = null;

  constructor(
    private base: string,
    private chainId: number,
    private apiKey?: string,
    private fetchFn: typeof fetch = fetch,
  ) {}

  private headers(): Record<string, string> {
    return { "content-type": "application/json", ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) };
  }

  /** The whole price ladder for the chain, refreshed every couple of seconds. */
  async ladders(): Promise<Map<string, Ladder>> {
    if (this.cache && Date.now() - this.cache.at < 2_000) return this.cache.map;
    const res = await this.fetchFn(`${this.base}/rfq/levels?chainId=${this.chainId}`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`textile levels: HTTP ${res.status}`);
    const body = (await res.json()) as {
      data: { pairs: { sellToken: Address; buyToken: Address; minSellAmount: string; maxSellAmount: string; levels: { sellAmount: string; buyAmount: string }[] }[] };
    };
    const map = new Map<string, Ladder>();
    for (const p of body.data.pairs) {
      map.set(key(p.sellToken, p.buyToken), {
        sellToken: p.sellToken,
        buyToken: p.buyToken,
        minSell: BigInt(p.minSellAmount),
        maxSell: BigInt(p.maxSellAmount),
        levels: p.levels.map((l) => ({ sellAmount: BigInt(l.sellAmount), buyAmount: BigInt(l.buyAmount) })),
      });
    }
    this.cache = { at: Date.now(), map };
    return map;
  }

  /**
   * What selling `amount` of `sell` would return right now, read off the ladder. Null when the
   * pair isn't quoted or the size is outside what makers are offering.
   */
  async indicative(sell: Address, buy: Address, amount: bigint): Promise<bigint | null> {
    const ladder = (await this.ladders()).get(key(sell, buy));
    return ladder ? interpolate(ladder, amount) : null;
  }

  async firm(args: { sellToken: Address; buyToken: Address; sellAmount: bigint; taker: TakerSigner }): Promise<FirmQuote | NoQuote> {
    const body: Record<string, unknown> = {
      chainId: this.chainId,
      sellToken: args.sellToken,
      buyToken: args.buyToken,
      sellAmount: args.sellAmount.toString(),
      taker: args.taker.address,
    };
    // Without a partner key the venue wants proof we control the taker wallet: one signature.
    if (!this.apiKey) body.takerProof = await this.proof(args.taker);
    const res = await this.fetchFn(`${this.base}/rfq/request`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(75_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`textile request: HTTP ${res.status} ${text.slice(0, 200)}`);
    const { data } = JSON.parse(text) as { data: Record<string, any> };
    if (data.status !== "quoted") {
      return {
        status: "no_quote",
        reason: String(data.reason ?? "no_quote"),
        available: data.availableSellAmount ? BigInt(data.availableSellAmount) : undefined,
        retryAfterMs: data.retryAfterMs,
      };
    }
    if (data.route) throw new Error("textile returned a recall quote, which this agent did not ask for");
    const q = data.quote;
    return {
      status: "quoted",
      rfqId: data.rfqId,
      claimToken: data.claimToken,
      takerPays: BigInt(q.takerPays),
      buyAmount: BigInt(q.buyAmount),
      feeAmount: BigInt(q.feeAmount ?? 0),
      spender: q.spender ?? q.reactor,
      expiresAt: Date.parse(q.expiresAt),
      approval: data.transactions.approval,
      swap: data.transactions.swap,
      makers: ((q.orders ?? []) as { maker?: Address }[]).map((o) => o.maker).filter((m): m is Address => Boolean(m)),
    };
  }

  /** Tells the venue which transaction settled the quote. Best effort: fills are indexed on-chain anyway. */
  async submit(rfqId: string, claimToken: string, txHash: Hex): Promise<void> {
    await this.fetchFn(`${this.base}/rfq/${rfqId}/submit`, {
      method: "POST",
      headers: { ...this.headers(), "X-Rfq-Claim": claimToken },
      body: JSON.stringify({ txHash }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {});
  }

  async cancel(rfqId: string, claimToken: string): Promise<void> {
    await this.fetchFn(`${this.base}/rfq/${rfqId}/cancel`, {
      method: "POST",
      headers: { ...this.headers(), "X-Rfq-Claim": claimToken },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {});
  }

  private async proof(taker: TakerSigner) {
    const nonce = toHex(randomBytes(32));
    const issuedAt = Date.now();
    const signature = await taker.signTypedData({
      domain: { name: "Textile Taker Control", version: "1", chainId: this.chainId },
      types: TAKER_CONTROL,
      primaryType: "TakerControl",
      message: { taker: taker.address, chainId: BigInt(this.chainId), nonce, issuedAt: BigInt(issuedAt) },
    });
    return { nonce, issuedAt, signature };
  }
}

/** Linear interpolation between the two ladder points around `amount`. */
export function interpolate(ladder: Ladder, amount: bigint): bigint | null {
  const { levels } = ladder;
  if (!levels.length || amount < ladder.minSell || amount > ladder.maxSell) return null;
  if (amount <= levels[0].sellAmount) return (amount * levels[0].buyAmount) / levels[0].sellAmount;
  for (let i = 1; i < levels.length; i++) {
    const a = levels[i - 1];
    const b = levels[i];
    if (amount <= b.sellAmount) {
      const span = b.sellAmount - a.sellAmount;
      if (span === 0n) return a.buyAmount;
      return a.buyAmount + ((b.buyAmount - a.buyAmount) * (amount - a.sellAmount)) / span;
    }
  }
  const last = levels[levels.length - 1];
  return (amount * last.buyAmount) / last.sellAmount;
}
