import { randomBytes } from "node:crypto";
import { paymentMiddleware } from "@x402/hono";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { formatUnits, isAddress, parseUnits, toHex, type Address, type Hex } from "viem";
import { z } from "zod";
import { authMessage, issueNonce, verifySigned } from "./auth.js";
import type { Chain } from "./chain.js";
import type { Config } from "./config.js";
import type { Availability } from "./availability.js";
import { CURRENCIES, ENABLED, isCurrency, type CurrencyCode } from "./currencies.js";
import type { Order, OrderEvent, Store } from "./db.js";
import { RUNNING, type Engine } from "./engine.js";
import { applyPayment, checkDirect, createPayments, PAY_ROUTE } from "./payments.js";
import type { Rates, Reference } from "./rates.js";
import { NoRoute, price, priceForOutput, type Venues } from "./router.js";
import { hostOf, pickOffer, readOffers } from "./target.js";
import type { createWorker } from "./worker.js";

const signed = z.object({ address: z.string(), nonce: z.string(), signature: z.string().startsWith("0x") });
const withAuth = <T extends z.ZodRawShape>(shape: T) => z.object({ ...shape, auth: signed });

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const FOLDED_EVENTS = new Set(["retry"]);

function timeline(events: OrderEvent[]) {
  const out: { kind: string; tx: string | null; at: number; detail: Record<string, unknown> | null }[] = [];
  for (const { kind, tx, at, detail } of events) {
    const last = out.at(-1);
    if (last?.kind === kind && FOLDED_EVENTS.has(kind)) Object.assign(last, { tx, at, detail });
    else out.push({ kind, tx, at, detail });
  }
  return out;
}

const PAY_GRACE_MS = 30_000;
const orderId = () => toHex(randomBytes(32));
const quoteId = () => randomBytes(9).toString("base64url");
const partnerCode = (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "partner"}-${randomBytes(2).toString("hex")}`;

type Worker = ReturnType<typeof createWorker>;

/** What any quote shows next to our price: the same amount at the official cross rate and at the street one. */
export function compare(ref: Reference, from: CurrencyCode, to: CurrencyCode, amountIn: bigint, estOut: bigint) {
  const f = CURRENCIES[from];
  const t = CURRENCIES[to];
  const inUnits = Number(formatUnits(amountIn, f.decimals));
  const ours = Number(formatUnits(estOut, t.decimals)) / inUnits;
  const at = (kind: "official" | "street") => {
    const rf = f.fiat === "USD" ? 1 : (ref.fiats[f.fiat]?.[kind] ?? ref.fiats[f.fiat]?.official ?? null);
    const rt = t.fiat === "USD" ? 1 : (ref.fiats[t.fiat]?.[kind] ?? ref.fiats[t.fiat]?.official ?? null);
    return rf && rt ? rt / rf : null;
  };
  const official = at("official");
  const street = at("street");
  return {
    rate: ours,
    official: official ? { rate: official, out: inUnits * official } : null,
    street: street && street !== official ? { rate: street, out: inUnits * street } : null,
  };
}

export function createApp(cfg: Config, store: Store, chain: Chain, venues: Venues, rates: Rates, engine: Engine, availability: Availability, worker?: Worker) {
  const app = new Hono();
  const { server, routes } = createPayments(cfg, store, chain, engine);

  app.use("*", cors({ origin: "*", exposeHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE", "X-PAYMENT-RESPONSE"] }));
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 429);
    if (err instanceof NoRoute) return c.json({ error: err.message }, 422);
    if (err instanceof z.ZodError || err instanceof SyntaxError) return c.json({ error: "invalid request" }, 400);
    // Plain Errors are the ones thrown here on purpose, worded for people. RPC, database and
    // network errors are subclasses and can carry URLs or keys, so they stay in the logs.
    if (Object.getPrototypeOf(err) === Error.prototype) return c.json({ error: err.message }, 400);
    console.error(`[${c.req.method} ${c.req.path}]`, err);
    return c.json({ error: "something went wrong on our side, try again" }, 500);
  });

  const ip = (c: Context) => c.req.header("x-real-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  async function limit(key: string, max: number, windowMs: number) {
    if (!(await store.hit(key, max, windowMs))) throw new HttpError(429, "too many requests, try again in a bit");
  }
  const signer = (action: string, body: { auth: unknown }) => verifySigned(store, action, body.auth as never);

  app.get("/api/health", async (c) => {
    c.header("cache-control", "no-store");
    return c.json({ ok: true, now: Date.now() });
  });

  app.get("/api/config", async (c) => {
    c.header("cache-control", "public, s-maxage=60, stale-while-revalidate=600");
    return c.json({
      chainId: cfg.chain.id,
      network: cfg.network,
      explorer: cfg.explorer,
      agent: chain.address,
      agentId: cfg.agentId?.toString() ?? null,
      currencies: await availability.currencies(),
      limits: { minUsd: cfg.minOrderUsd, maxUsd: cfg.maxOrderUsd, feeBps: cfg.feeBps, partnerBps: cfg.partnerBps, quoteSeconds: cfg.quoteTtlMs / 1000, slippageBps: cfg.slippageBps },
    });
  });

  app.get("/api/auth/nonce/:address", async (c) => {
    await limit(`nonce:${ip(c)}`, 120, 60_000);
    const nonce = await issueNonce(store, c.req.param("address"));
    return c.json({ nonce, message: authMessage("<action>", nonce) });
  });

  const enabled = async (v: unknown): Promise<boolean> => isCurrency(v) && (await availability.enabled(v));

  // A quote is a priced route that holds for a short while. The order is made from it at pay time.
  app.get("/api/quote", async (c) => {
    await limit(`quote:${ip(c)}`, 120, 60_000);
    const from = c.req.query("from") as CurrencyCode;
    const to = c.req.query("to") as CurrencyCode;
    const amount = c.req.query("amount") ?? "";
    if (!(await enabled(from)) || !(await enabled(to))) throw new Error("pick two of the currencies we change today");
    if (!/^\d+(\.\d{1,18})?$/.test(amount)) throw new Error("enter an amount");
    const amountIn = parseUnits(amount, CURRENCIES[from].decimals);
    if (amountIn === 0n) throw new Error("enter an amount");
    const partner = c.req.query("partner") ? await store.partner(c.req.query("partner")!) : null;
    const ref = await rates.reference().catch(() => null);
    const priced = await price(cfg, venues, from, to, amountIn, ref);
    const quote = await store.createQuote({
      id: quoteId(),
      from,
      to,
      amountIn: priced.amountIn.toString(),
      estOut: priced.estOut.toString(),
      minOut: priced.minOut.toString(),
      fee: priced.fee.toString(),
      usd: priced.usd,
      route: priced.route,
      partner: partner?.code ?? null,
      target: null,
      expiresAt: Date.now() + cfg.quoteTtlMs,
    });
    return c.json({ quote: publicQuote(quote), compare: ref ? compare(ref, from, to, priced.amountIn, priced.estOut) : null });
  });

  // Paying someone else's x402 endpoint in the currency the payer holds. Cruce reads the seller's
  // price, quotes the exact input that covers it, and on payment converts and pays the seller.
  const payQuote = z.object({
    url: z.string().url().max(2_000),
    method: z.enum(["GET", "POST", "PUT"]).default("GET"),
    body: z.string().max(20_000).optional(),
    contentType: z.string().max(100).optional(),
    from: z.string(),
    partner: z.string().max(40).optional(),
  });
  app.post("/api/pay/quote", async (c) => {
    await limit(`payquote:${ip(c)}`, 60, 60_000);
    const body = payQuote.parse(await c.req.json());
    if (!(await enabled(body.from))) throw new Error("pay with one of the currencies we change today");
    const from = body.from as CurrencyCode;
    const url = new URL(body.url);
    if (url.protocol !== "https:") throw new Error("only https services can be paid");
    if (url.host === new URL(cfg.publicUrl).host) throw new Error("that is Cruce itself");
    const init: RequestInit = { method: body.method, headers: body.contentType ? { "content-type": body.contentType } : {}, body: body.body };
    const offers = await readOffers(body.url, init);
    if (!offers.length) throw new Error("that service doesn't take payment on Celo in a currency Cruce can produce");
    if (offers.some((o) => o.code === from)) throw new HttpError(409, `that service already accepts ${CURRENCIES[from].label}, pay it directly`);
    const offer = pickOffer(offers, from);
    if (!offer) throw new Error("that service asks for a currency Cruce can't produce yet");
    const partner = body.partner ? await store.partner(body.partner) : null;
    const ref = await rates.reference().catch(() => null);
    const priced = await priceForOutput(cfg, venues, from, offer.code, BigInt(offer.amount), ref, { flatUsd: cfg.payFlatUsd, minUsd: cfg.minPayUsd });
    const quote = await store.createQuote({
      id: quoteId(),
      from,
      to: offer.code,
      amountIn: priced.amountIn.toString(),
      estOut: priced.estOut.toString(),
      minOut: priced.minOut.toString(),
      fee: priced.fee.toString(),
      usd: priced.usd,
      route: priced.route,
      partner: partner?.code ?? null,
      target: { url: body.url, method: body.method, body: body.body ?? null, contentType: body.contentType ?? null, offer },
      expiresAt: Date.now() + cfg.quoteTtlMs,
    });
    return c.json({
      quote: publicQuote(quote),
      service: { host: hostOf(body.url), currency: offer.code, amount: offer.amount, display: formatUnits(BigInt(offer.amount), CURRENCIES[offer.code].decimals) },
    });
  });

  // What the paid service answered. The order id is a 32-byte secret only the payer was given.
  app.get("/api/orders/:id/result", async (c) => {
    c.header("cache-control", "no-store");
    const order = await loadOrder(c);
    if (!order.target) throw new HttpError(404, "this order didn't pay a service");
    if (order.result?.state !== "paid") return c.json({ status: order.status, ready: false }, 202);
    return c.json({ ready: true, status: order.result.status, contentType: order.result.contentType, body: order.result.body, tx: order.result.tx });
  });

  const newOrder = z.object({ quoteId: z.string().min(6).max(32), recipient: z.string().refine(isAddress).optional() });

  app.post("/api/orders", async (c) => {
    await limit(`order:${ip(c)}`, 60, 3_600_000);
    const body = newOrder.parse(await c.req.json());
    const quote = await store.quote(body.quoteId);
    if (!quote) throw new HttpError(404, "quote not found");
    if (Date.now() > quote.expiresAt) throw new HttpError(410, "that quote expired, get a fresh one");
    if (body.recipient && body.recipient.toLowerCase() === chain.address.toLowerCase()) throw new Error("that is the agent's own address");
    const order = await store.createOrder(quote, orderId(), body.recipient ?? null);
    return c.json({ order: publicOrder(order), payUrl: `${cfg.publicUrl}${PAY_ROUTE.replace(":id", order.id)}`, expiresAt: quote.expiresAt + PAY_GRACE_MS });
  });

  async function loadOrder(c: Context) {
    const order = await store.order(c.req.param("id") ?? "");
    if (!order) throw new HttpError(404, "order not found");
    return order;
  }

  app.get("/api/orders/:id", async (c) => {
    c.header("cache-control", "no-store");
    const order = await loadOrder(c);
    const quote = order.status === "awaiting_payment" ? await store.quote(order.quoteId) : null;
    // When the gasless rail is refusing to settle, the page pays by a plain transfer instead.
    const transfer = order.status === "awaiting_payment" && (await store.gaslessDown(Date.now() - 10 * 60_000));
    return c.json({ order: publicOrder(order), events: timeline(await store.events(order.id)), payUntil: quote ? quote.expiresAt + PAY_GRACE_MS : null, transfer });
  });

  // The page that was paying may have lost its connection mid-run; anyone with the link can nudge
  // the order forward. Harmless to repeat: a running order is skipped and a finished one untouched.
  // Paying with a plain token transfer, for currencies Celo's x402 facilitator doesn't settle. The
  // transfer carries the order id in its calldata; the agent reads it back and runs the order.
  const directBody = z.object({ tx: z.string().regex(/^0x[0-9a-fA-F]{64}$/) });
  app.post("/api/orders/:id/paid", async (c) => {
    await limit(`paid:${ip(c)}`, 120, 60_000);
    const order = await loadOrder(c);
    const { tx } = directBody.parse(await c.req.json());
    if (order.status !== "awaiting_payment") {
      if (order.paidTx === tx) return c.json({ order: publicOrder(order) });
      throw new HttpError(409, "this order is already paid");
    }
    const check = await checkDirect(chain, order, tx as Hex);
    if (check.state === "pending") return c.json({ waiting: true }, 202);
    if (check.state === "invalid") throw new Error(check.reason);
    if (check.state === "short") {
      // Money arrived but not enough: it goes back rather than running a smaller order.
      await store.addOrphan({ orderId: order.id, payer: check.payer, currency: order.from, amount: check.amount, tx, reason: "short_transfer" });
      throw new HttpError(409, "that transfer was less than the order, so it's being sent back");
    }
    const outcome = await applyPayment(store, order, { payer: check.payer, currency: order.from, amount: order.amountIn, tx });
    if (outcome !== "applied" && outcome !== "duplicate") throw new HttpError(409, "this order is already paid");
    // Anything paid above the order goes back with the change.
    const extra = BigInt(check.amount) - BigInt(order.amountIn);
    if (extra > 0n) await store.addOrphan({ orderId: order.id, payer: check.payer, currency: order.from, amount: extra.toString(), tx: `${tx}:extra`, reason: "overpaid" });
    const after = await engine.run(order.id);
    return c.json({ order: publicOrder(after ?? order) });
  });

  app.post("/api/orders/:id/resume", async (c) => {
    await limit(`resume:${ip(c)}`, 30, 60_000);
    const order = await loadOrder(c);
    if (!(RUNNING as readonly string[]).includes(order.status) || Date.now() - order.updatedAt < 20_000) return c.json({ order: publicOrder(order) });
    const after = await engine.run(order.id);
    return c.json({ order: publicOrder(after ?? order) });
  });

  app.get("/api/wallets/:address/orders", async (c) => {
    const address = c.req.param("address");
    if (!isAddress(address)) throw new Error("invalid address");
    return c.json({ orders: (await store.ordersByWallet(address)).map(publicOrder) });
  });

  app.get("/api/activity", async (c) => {
    c.header("cache-control", "public, s-maxage=30, stale-while-revalidate=300");
    return c.json(await store.activity());
  });

  app.get("/api/rates", async (c) => {
    c.header("cache-control", "public, s-maxage=60, stale-while-revalidate=600");
    return c.json(await rates.reference());
  });

  // Anyone can send conversions and keep part of the fee. One signature registers a payout address.
  app.post("/api/partners", async (c) => {
    const body = withAuth({ name: z.string().trim().min(2).max(40), address: z.string().refine(isAddress).optional() }).parse(await c.req.json());
    const who = await signer("partner", body);
    await limit(`partner:${who}`, 5, 86_400_000);
    const partner = await store.createPartner({ code: partnerCode(body.name), name: body.name, address: body.address ?? who, shareBps: cfg.partnerBps });
    return c.json({ partner });
  });

  app.get("/api/partners/:code", async (c) => {
    const partner = await store.partner(c.req.param("code"));
    if (!partner) throw new HttpError(404, "partner not found");
    return c.json({ partner: { code: partner.code, name: partner.name, address: partner.address, shareBps: partner.shareBps }, stats: await store.partnerStats(partner.code) });
  });

  app.get("/api/partners/by/:address", async (c) => {
    const address = c.req.param("address");
    if (!isAddress(address)) throw new Error("invalid address");
    return c.json({ partners: await store.partnersByAddress(address) });
  });

  // A wallet made at sign-in holds dollars but no CELO for gas. Its owner signs a transfer
  // authorisation and the agent sends it for them. Dollar tokens only: the pesos use Permit2.
  const sendBody = z.object({
    token: z.string().refine((t) => isCurrency(t) && CURRENCIES[t as CurrencyCode].method === "eip3009"),
    from: z.string().refine(isAddress),
    to: z.string().refine(isAddress),
    value: z.string().regex(/^\d+$/),
    validAfter: z.string().regex(/^\d+$/),
    validBefore: z.string().regex(/^\d+$/),
    nonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
  });
  app.post("/api/wallet/send", async (c) => {
    const body = sendBody.parse(await c.req.json());
    await limit(`send:${body.from.toLowerCase()}`, 20, 86_400_000);
    await limit("send-all", 500, 86_400_000);
    if (BigInt(body.value) === 0n) throw new Error("nothing to send");
    if (body.to.toLowerCase() === body.from.toLowerCase()) throw new Error("that's your own address");
    const { hash } = await chain.transferWithAuthorization(
      body.token as CurrencyCode,
      { from: body.from as Address, to: body.to as Address, value: BigInt(body.value), validAfter: BigInt(body.validAfter), validBefore: BigInt(body.validBefore), nonce: body.nonce as Hex },
      body.signature as Hex,
    );
    return c.json({ tx: hash });
  });

  const operator = (c: Context) => Boolean(cfg.workerSecret) && c.req.header("authorization") === `Bearer ${cfg.workerSecret}`;

  app.post("/api/worker/tick", async (c) => {
    if (!worker || !operator(c)) return c.json({ error: "not allowed" }, 403);
    return c.json(await worker.tick());
  });

  app.get("/api/admin/orders", async (c) => {
    if (!operator(c)) return c.json({ error: "not allowed" }, 403);
    const orders = await store.recentOrders(Number(c.req.query("limit") ?? 50));
    const events = Object.fromEntries(await Promise.all(orders.map(async (o) => [o.id, await store.events(o.id)])));
    const orphans = (await Promise.all((["unconfirmed", "pending", "refunding", "failed"] as const).map((s) => store.orphans(s)))).flat();
    const balances = Object.fromEntries(await Promise.all(ENABLED.map(async (code) => [code, (await chain.balance(code).catch(() => 0n)).toString()])));
    return c.json({ orders, events, orphans, balances });
  });

  app.get("/api/proof/buy", async (c) => c.json({ payer: chain.address, calls: await store.buyCalls() }));

  app.get("/.well-known/agent-registration.json", (c) =>
    c.json({
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: "Cruce",
      description:
        "Currency exchange agent on Celo. Changes pesos, reais, naira and dollars into each other at the best price across Textile, Uniswap and Mento, settles the payment over x402, and sends the result to any wallet.",
      image: `${cfg.webOrigin}/icon.png`,
      services: [
        { name: "web", endpoint: cfg.webOrigin },
        { name: "x402", endpoint: `${cfg.publicUrl}${PAY_ROUTE}` },
        { name: "quote", endpoint: `${cfg.publicUrl}/api/quote` },
      ],
      // One verified human stands behind this agent: Self Agent ID, owned by the agent's wallet.
      selfAgentId: { chainId: 42220, registry: "0xaC3DF9ABf80d0F5c020C06B04Cced27763355944", agentId: "203", agent: "0xe14B67946d8f6B81D772503Cd57617EeA727a327" },
      supportedTrust: ["reputation"],
    }),
  );

  // An order that is already paid, expired or unknown gets a clear answer instead of a payment request.
  app.use(PAY_ROUTE, async (c, next) => {
    await limit(`pay:${ip(c)}`, 300, 3_600_000);
    const order = await store.order(c.req.param("id") ?? "");
    if (!order) return c.json({ error: "order not found" }, 404);
    if (order.status !== "awaiting_payment") return c.json({ error: "this order is already paid", order: publicOrder(order) }, 409);
    const quote = await store.quote(order.quoteId);
    if (!quote || Date.now() > quote.expiresAt + PAY_GRACE_MS) return c.json({ error: "that quote expired, get a fresh one" }, 410);
    await next();
  });
  app.use(paymentMiddleware(routes, server));
  // Settlement and the run happen after this handler, so the state is read back with a GET.
  app.post(PAY_ROUTE, (c) => c.json({ ok: true, id: c.req.param("id") }));

  return app;
}

const display = (amount: string | null, code: CurrencyCode) => (amount == null ? null : formatUnits(BigInt(amount), CURRENCIES[code].decimals));

export function publicQuote(q: { id: string; from: CurrencyCode; to: CurrencyCode; amountIn: string; estOut: string; minOut: string; fee: string; usd: string; route: { legs: { venue: string; from: string; to: string }[]; feeToken: CurrencyCode }; partner: string | null; target?: { url: string; offer: { code: CurrencyCode; amount: string } } | null; expiresAt: number }) {
  return {
    id: q.id,
    from: q.from,
    to: q.to,
    amountIn: q.amountIn,
    estOut: q.estOut,
    minOut: q.minOut,
    fee: q.fee,
    feeToken: q.route.feeToken,
    usd: q.usd,
    display: { in: display(q.amountIn, q.from), out: display(q.estOut, q.to), min: display(q.minOut, q.to), fee: display(q.fee, q.route.feeToken) },
    legs: q.route.legs.map((l) => ({ venue: l.venue, from: l.from, to: l.to })),
    partner: q.partner,
    service: q.target ? { host: hostOf(q.target.url), currency: q.target.offer.code, amount: q.target.offer.amount } : null,
    expiresAt: q.expiresAt,
  };
}

export function publicOrder(o: Order) {
  return {
    id: o.id,
    from: o.from,
    to: o.to,
    amountIn: o.amountIn,
    estOut: o.estOut,
    minOut: o.minOut,
    out: o.outAmount,
    fee: o.feeTaken ?? o.fee,
    feeToken: o.route.feeToken,
    usd: o.usd,
    display: { in: display(o.amountIn, o.from), out: display(o.outAmount ?? o.estOut, o.to), min: display(o.minOut, o.to) },
    legs: o.route.legs.map((l) => ({ venue: l.venue, from: l.from, to: l.to, tx: l.tx ?? null, out: l.out ?? null, counterparties: l.counterparties ?? [] })),
    payer: o.payer,
    recipient: o.recipient,
    partner: o.partner,
    service: o.target ? { host: hostOf(o.target.url), currency: o.target.offer.code, amount: o.target.offer.amount, answered: o.result?.state === "paid" ? o.result.status : null } : null,
    status: o.status,
    paidTx: o.paidTx,
    payoutTx: o.payoutTx,
    refundTx: o.refundTx,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}
