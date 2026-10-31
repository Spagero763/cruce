const BASE = (import.meta.env.VITE_AGENT_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export interface Currency {
  code: string;
  label: string;
  fiat: string;
  locale: string;
  country: string;
  address: `0x${string}`;
  decimals: number;
  method: "eip3009" | "permit2";
  domain: { name: string; version: string };
  kind: "dollar" | "local";
  enabled: boolean;
  payIn?: boolean;
}

export interface AppConfig {
  chainId: number;
  network: "mainnet" | "testnet";
  explorer: string;
  agent: `0x${string}`;
  agentId: string | null;
  currencies: Currency[];
  limits: { minUsd: number; maxUsd: number; feeBps: number; partnerBps: number; quoteSeconds: number; slippageBps: number };
}

export type OrderStatus = "awaiting_payment" | "paid" | "swapping" | "paying_out" | "done" | "refunding" | "refunded" | "attention";

export interface Leg {
  venue: "textile" | "uniswap_v3" | "uniswap_v4" | "mento";
  from: string;
  to: string;
  tx: string | null;
  out: string | null;
  counterparties: string[];
}

export interface Quote {
  id: string;
  from: string;
  to: string;
  amountIn: string;
  estOut: string;
  minOut: string;
  fee: string;
  feeToken: string;
  usd: string;
  display: { in: string; out: string; min: string; fee: string };
  legs: { venue: string; from: string; to: string }[];
  partner: string | null;
  expiresAt: number;
}

export interface Compare {
  rate: number;
  official: { rate: number; out: number } | null;
  street: { rate: number; out: number } | null;
}

export interface Order {
  id: `0x${string}`;
  from: string;
  to: string;
  amountIn: string;
  estOut: string;
  minOut: string;
  out: string | null;
  fee: string;
  feeToken: string;
  usd: string;
  display: { in: string; out: string; min: string };
  legs: Leg[];
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

export interface OrderEvent {
  kind: string;
  tx: string | null;
  at: number;
  detail: Record<string, unknown> | null;
}

export interface Activity {
  done: number;
  wallets: number;
  usd: string;
  corridors: { from: string; to: string; count: number; usd: string }[];
  recent: { id: string; from: string; to: string; amountIn: string; out: string | null; usd: string; at: number; tx: string | null }[];
}

export interface Partner {
  code: string;
  name: string;
  address: string;
  shareBps: number;
}

export interface Signed {
  address: string;
  nonce: string;
  signature: `0x${string}`;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

let configPromise: Promise<AppConfig> | null = null;

export const api = {
  config: () => (configPromise ??= req<AppConfig>("/api/config")),
  activity: () => req<Activity>("/api/activity"),
  nonce: (address: string) => req<{ nonce: string }>(`/api/auth/nonce/${address}`),
  quote: (from: string, to: string, amount: string, partner?: string | null, signal?: AbortSignal) =>
    req<{ quote: Quote; compare: Compare | null }>(`/api/quote?${new URLSearchParams({ from, to, amount, ...(partner ? { partner } : {}) })}`, { signal }),
  createOrder: (quoteId: string, recipient?: string) =>
    req<{ order: Order; payUrl: string; expiresAt: number }>("/api/orders", { method: "POST", body: JSON.stringify({ quoteId, recipient }) }),
  order: (id: string) => req<{ order: Order; events: OrderEvent[]; payUntil: number | null }>(`/api/orders/${id}`),
  resume: (id: string) => req<{ order: Order }>(`/api/orders/${id}/resume`, { method: "POST" }),
  myOrders: (address: string) => req<{ orders: Order[] }>(`/api/wallets/${address}/orders`),
  send: (body: { token: string; from: string; to: string; value: string; validAfter: string; validBefore: string; nonce: string; signature: string }) =>
    req<{ tx: string }>("/api/wallet/send", { method: "POST", body: JSON.stringify(body) }),
  createPartner: (name: string, auth: Signed, address?: string) =>
    req<{ partner: Partner }>("/api/partners", { method: "POST", body: JSON.stringify({ name, address, auth }) }),
  partner: (code: string) => req<{ partner: Partner; stats: { done: number; usd: string } }>(`/api/partners/${code}`),
  partnersOf: (address: string) => req<{ partners: Partner[] }>(`/api/partners/by/${address}`),
};

export const payUrlFor = (id: string) => `${BASE || location.origin}/x402/orders/${id}/pay`;
export const authMessage = (action: string, nonce: string) => `Cruce\n\nAction: ${action}\nNonce: ${nonce}`;
