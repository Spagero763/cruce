// Paying someone else's x402 endpoint on a payer's behalf. The seller names one asset; the payer
// holds another. Cruce reads the seller's price, converts, and pays it from the agent's wallet.
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { ExactEvmSchemeV1 } from "@x402/evm/exact/v1/client";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import type { Address, Hex } from "viem";
import type { Chain } from "./chain.js";
import { byAddress, CURRENCIES, type CurrencyCode } from "./currencies.js";
import { PERMIT2 } from "./uniswap.js";

export interface Offer {
  version: 1 | 2;
  network: string;
  asset: Address;
  code: CurrencyCode;
  amount: string;
  payTo: Address;
}

export interface Target {
  url: string;
  method: string;
  body: string | null;
  contentType: string | null;
  offer: Offer;
}

export interface Paid {
  status: number;
  contentType: string | null;
  body: string;
  tx: string | null;
}

/** A target was paid and answered, but its answer could not be stored or read back. */
export class NotPaid extends Error {}

const MAX_BODY = 200_000;
const CELO = new Set(["eip155:42220", "celo"]);

interface RawOffer {
  scheme?: string;
  network?: string;
  asset?: string;
  amount?: string;
  maxAmountRequired?: string;
  payTo?: string;
}

/** Fetches the target without paying and reads every Celo offer in an asset Cruce can produce. */
export async function readOffers(url: string, init: RequestInit, fetchFn: typeof fetch = fetch): Promise<Offer[]> {
  const res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(20_000) });
  if (res.status !== 402) throw new Error(`that address did not ask for a payment (HTTP ${res.status})`);
  const header = res.headers.get("payment-required");
  let raw: { x402Version?: number; accepts?: RawOffer[] };
  try {
    raw = header ? JSON.parse(Buffer.from(header, "base64").toString()) : await res.json();
  } catch {
    throw new Error("that address returned a payment request Cruce can't read");
  }
  const version = raw.x402Version === 1 ? 1 : header ? 2 : (raw.x402Version ?? 1) === 2 ? 2 : 1;
  const out: Offer[] = [];
  for (const o of raw.accepts ?? []) {
    if (o.scheme !== "exact" || !o.network || !CELO.has(o.network) || !o.asset || !o.payTo) continue;
    const code = byAddress(o.asset);
    const amount = o.amount ?? o.maxAmountRequired;
    if (!code || !amount || !/^\d+$/.test(amount)) continue;
    out.push({ version: o.network === "celo" ? 1 : version, network: o.network, asset: o.asset as Address, code, amount, payTo: o.payTo as Address });
  }
  return out;
}

/** The offer to pay: the payer's own currency means no conversion is needed, so it is never chosen here. */
export function pickOffer(offers: Offer[], from: CurrencyCode): Offer | null {
  const usable = offers.filter((o) => o.code !== from && CURRENCIES[o.code].enabled);
  const rank = (o: Offer) => (o.code === "USDT" ? 0 : CURRENCIES[o.code].kind === "dollar" ? 1 : 2);
  return usable.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** Pays the target from the agent's wallet, for exactly the offer that was quoted and nothing else. */
export async function payTarget(chain: Chain, target: Target, fetchFn: typeof fetch = fetch): Promise<Paid> {
  const { offer } = target;
  const currency = CURRENCIES[offer.code];
  if (currency.method === "permit2") await chain.ensureAllowance(offer.code, PERMIT2, BigInt(offer.amount));

  const signer = {
    address: chain.address,
    signTypedData: (m: Record<string, unknown>) => chain.account.signTypedData(m as never),
    readContract: (a: Record<string, unknown>) => chain.pub.readContract(a as never),
  };
  const client = new x402Client();
  client.register("eip155:42220", new ExactEvmScheme(signer as never) as never);
  client.registerV1("celo", new ExactEvmSchemeV1(signer as never) as never);
  client.setSpendControls({
    maxAmountPerPayment: false,
    allowedAssets: [{ network: offer.network as never, asset: offer.asset, maxAmountPerPayment: offer.amount }],
  });

  const headers: Record<string, string> = target.contentType ? { "content-type": target.contentType } : {};
  const res = await wrapFetchWithPayment(fetchFn, client)(target.url, {
    method: target.method,
    headers,
    body: target.body ?? undefined,
    signal: AbortSignal.timeout(90_000),
  });
  const receipt = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
  let tx: string | null = null;
  try {
    tx = receipt ? (JSON.parse(Buffer.from(receipt, "base64").toString()).transaction ?? null) : null;
  } catch {
    tx = null;
  }
  // x402 sellers settle only once their handler succeeds; no receipt and no success means no charge.
  if (!receipt && !res.ok) throw new NotPaid(`the service refused the payment (HTTP ${res.status})`);
  const text = await res.text().catch(() => "");
  return { status: res.status, contentType: res.headers.get("content-type"), body: text.slice(0, MAX_BODY), tx };
}

export const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export type { Hex };
