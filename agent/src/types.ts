import type { Address } from "viem";
import type { CurrencyCode } from "./currencies.js";

export type Venue = "textile" | "uniswap_v3" | "uniswap_v4" | "mento";

/** Where a Uniswap leg trades. v3 pools are found by fee tier; v4 pools carry their whole key. */
export type PoolRef =
  | { kind: "v3"; fee: number }
  | { kind: "mento"; fee: number }
  | { kind: "v4"; currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };

export interface Leg {
  venue: Venue;
  from: CurrencyCode;
  to: CurrencyCode;
  pool?: PoolRef;
  /** What the quote expected in and out of this leg, in atomic units. */
  quotedIn: string;
  quotedOut: string;
  /** Filled in as the order runs. */
  tx?: string | null;
  /** What actually came out, read off the receipt. Null until the leg has landed. */
  out?: string | null;
  /** The wallets on the other side of the fill, when the venue shows them. */
  counterparties?: string[];
}

export interface Route {
  legs: Leg[];
  /** The fee is taken from the amount entering this leg; `legs.length` means from the final amount. */
  feeLeg: number;
  feeToken: CurrencyCode;
  /** A fixed part of the fee, in atomic units of the fee token, that covers gas on very small orders. */
  flatFee?: string;
}
