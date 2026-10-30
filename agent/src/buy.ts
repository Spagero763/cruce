// Services Cruce pays for but doesn't own, bought per call through the buy gateway.
// Every call is quoted first, capped per call and per day, and logged with its settlement tx.
// The gateway speaks x402 v1: an EIP-3009 authorisation in the X-PAYMENT header.
import { randomBytes } from "node:crypto";
import { getAddress, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Config } from "./config.js";
import { CURRENCIES } from "./currencies.js";
import type { Store } from "./db.js";

const DAY_MS = 86_400_000;
const SEPOLIA_USDC = "0x01C5C0122039549AD1493B8220cABEdD739BC44E";

export class BudgetExceeded extends Error {}

interface Offer {
  scheme: string;
  network: string;
  asset: Address;
  payTo: Address;
  maxAmountRequired: string;
  maxTimeoutSeconds?: number;
  extra?: { name?: string; version?: string };
}

const TRANSFER_WITH_AUTHORIZATION = [
  { name: "from", type: "address" },
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" },
  { name: "nonce", type: "bytes32" },
] as const;

export type Buy = ReturnType<typeof createBuy>;

export function createBuy(cfg: Config, store: Store) {
  if (!cfg.privateKey) throw new Error("AGENT_PRIVATE_KEY is not set");
  const account = privateKeyToAccount(cfg.privateKey);
  const perCall = BigInt(Math.round(cfg.buyMaxUsd * 1e6));
  const perDay = BigInt(Math.round(cfg.buyDailyUsd * 1e6));
  const network = cfg.network === "mainnet" ? "celo" : "celo-sepolia";
  const preferred = (cfg.network === "mainnet" ? CURRENCIES[cfg.buyToken].address : SEPOLIA_USDC).toLowerCase();

  const pick = (offers: Offer[]) =>
    offers.find((o) => o.scheme === "exact" && o.network === network && o.asset.toLowerCase() === preferred) ??
    offers.find((o) => o.scheme === "exact" && o.network === network);

  // Timestamps come from the server's Date header so a skewed local clock can't expire them.
  let serverOffsetMs = 0;

  async function offerFor(url: string, init: RequestInit): Promise<Offer> {
    const res = await fetch(url, init);
    const date = Date.parse(res.headers.get("date") ?? "");
    if (Number.isFinite(date)) serverOffsetMs = date - Date.now();
    if (res.status !== 402) throw new Error(`expected 402 from ${url}, got ${res.status}`);
    const header = res.headers.get("payment-required");
    const body = header ? JSON.parse(Buffer.from(header, "base64").toString()) : await res.json();
    const offer = pick(body.accepts ?? []);
    if (!offer) throw new Error(`no ${network} offer from ${url}`);
    return offer;
  }

  async function paymentHeader(offer: Offer): Promise<string> {
    const now = Math.floor((Date.now() + serverOffsetMs) / 1000);
    const authorization = {
      from: account.address,
      to: getAddress(offer.payTo),
      value: offer.maxAmountRequired,
      validAfter: String(now - 60),
      validBefore: String(now + (offer.maxTimeoutSeconds ?? 300)),
      nonce: toHex(randomBytes(32)),
    };
    const signature = await account.signTypedData({
      domain: { name: offer.extra?.name, version: offer.extra?.version, chainId: cfg.chain.id, verifyingContract: getAddress(offer.asset) },
      types: { TransferWithAuthorization: TRANSFER_WITH_AUTHORIZATION },
      primaryType: "TransferWithAuthorization",
      message: {
        ...authorization,
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce: authorization.nonce as Hex,
      },
    });
    const payload = { x402Version: 1, scheme: "exact", network: offer.network, payload: { signature, authorization } };
    return Buffer.from(JSON.stringify(payload)).toString("base64");
  }

  // Never retried: a failure after settlement must not charge twice.
  async function call(service: string, url: string, init: RequestInit, orderId: string | null): Promise<Response> {
    const offer = await offerFor(url, init);
    const amount = BigInt(offer.maxAmountRequired);
    if (amount > perCall) throw new BudgetExceeded(`${service} costs ${amount}, cap is ${perCall}`);
    const spent = await store.buySpentSince(Date.now() - DAY_MS);
    if (spent + amount > perDay) throw new BudgetExceeded(`daily buy budget reached (${spent}/${perDay})`);

    const res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), "X-PAYMENT": await paymentHeader(offer) } });
    const receipt = res.headers.get("x-payment-response") ?? res.headers.get("payment-response");
    let tx: string | null = null;
    try {
      tx = receipt ? (JSON.parse(Buffer.from(receipt, "base64").toString()).transaction ?? null) : null;
    } catch {
      tx = null;
    }
    if (tx || res.ok) await store.addBuyCall({ orderId, service, url, amount: amount.toString(), token: offer.asset, tx });
    return res;
  }

  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  return {
    address: account.address,
    offerFor,

    raw: (service: string, url: string, body: unknown, orderId: string | null = null) => call(service, url, json(body), orderId),

    async rentBrowser(minutes: number, orderId: string | null = null) {
      const res = await call("browser", `${cfg.buyGateway}/v1/browser/sessions`, json({ durationMinutes: minutes }), orderId);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: unknown };
        throw new Error(`browser rental failed: HTTP ${res.status} ${JSON.stringify(body.error ?? body).slice(0, 300)}`);
      }
      const { browser } = (await res.json()) as { browser: BrowserLease };
      return new BrowserSession(browser);
    },

    async complete(system: string, user: string, orderId: string | null = null): Promise<string> {
      const res = await call(
        "inference",
        `${cfg.buyGateway}/cencori/v1/chat/completions`,
        json({
          model: "maximo-atlas-1.3",
          max_tokens: 256,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        orderId,
      );
      if (!res.ok) throw new Error(`inference failed: HTTP ${res.status}`);
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return body.choices?.[0]?.message?.content ?? "";
    },
  };
}

interface BrowserLease {
  sessionId: string;
  accessToken: string;
  status: string;
  expiresAt: string;
  statusUrl: string;
  commandUrl: string;
}

interface Output {
  text?: string;
  base64?: string;
  data?: { text?: string; title?: string; url?: string; base64?: string };
}

type Command =
  | { action: "open"; url: string }
  | { action: "wait"; milliseconds: number }
  | { action: "wait"; target: string }
  | { action: "click"; target: string }
  | { action: "get"; kind: "text"; target: string }
  | { action: "get"; kind: "url" | "title" }
  | { action: "screenshot" };

/** A rented browser. Commands are free, only rental time is paid. */
export class BrowserSession {
  constructor(private lease: BrowserLease) {}

  get expiresAt(): number {
    return Date.parse(this.lease.expiresAt);
  }

  private auth() {
    return { authorization: `Bearer ${this.lease.accessToken}` };
  }

  async ready(timeoutMs = 90_000): Promise<void> {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const res = await fetch(this.lease.statusUrl, { headers: this.auth() });
      const body = (await res.json().catch(() => ({}))) as { status?: string; browser?: { status?: string } };
      const status = body.browser?.status ?? body.status;
      if (status === "ready" || status === "active" || status === "running") return;
      if (status === "failed" || status === "expired" || status === "terminated") throw new Error(`browser ${status}`);
      await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error("browser did not become ready");
  }

  async command<T = unknown>(cmd: Command): Promise<T> {
    const res = await fetch(this.lease.commandUrl, {
      method: "POST",
      headers: { "content-type": "application/json", ...this.auth() },
      body: JSON.stringify(cmd),
      signal: AbortSignal.timeout(50_000),
    });
    const body = (await res.json().catch(() => ({}))) as { output?: T; error?: unknown };
    if (!res.ok) throw new Error(`browser ${cmd.action}: ${JSON.stringify(body.error ?? res.status)}`);
    return body.output as T;
  }

  /** Heavy pages can outlive the 40 s command limit while still loading, so a timeout is not fatal. */
  async open(url: string): Promise<void> {
    try {
      await this.command({ action: "open", url });
    } catch (err) {
      if (!String(err).includes("browser_runtime_error")) throw err;
    }
  }

  async text(target = "body"): Promise<string> {
    const out = await this.command<Output>({ action: "get", kind: "text", target });
    return out?.data?.text ?? out?.text ?? "";
  }

  async close(): Promise<void> {
    await fetch(this.lease.statusUrl, { method: "DELETE", headers: this.auth() }).catch(() => {});
  }
}
