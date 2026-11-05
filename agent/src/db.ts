import { randomUUID } from "node:crypto";
import type { CurrencyCode } from "./currencies.js";
import type { Paid, Target } from "./target.js";
import type { Route } from "./types.js";

/** The one thing Store needs from a database. Backed by Postgres in production and PGlite in tests. */
export interface Db {
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
}

type Row = Record<string, unknown>;

/**
 * paid: the payment landed, nothing converted yet. swapping: at least one leg is in flight or done.
 * paying_out: every leg landed, the result is on its way to the recipient. refunding: the order
 * can't complete and what the payer put in (or the dollars it became) is going back to them.
 */
export type OrderStatus = "awaiting_payment" | "paid" | "swapping" | "paying_out" | "done" | "refunding" | "refunded" | "attention";

export interface Quote {
  id: string;
  from: CurrencyCode;
  to: CurrencyCode;
  amountIn: string;
  estOut: string;
  minOut: string;
  fee: string;
  /** Dollar value of the hub leg, as a decimal string. */
  usd: string;
  route: Route;
  partner: string | null;
  /** Set when the result is paid to someone's x402 endpoint instead of sent to a wallet. */
  target: Target | null;
  expiresAt: number;
  createdAt: number;
}

export interface Order {
  id: string;
  quoteId: string;
  from: CurrencyCode;
  to: CurrencyCode;
  amountIn: string;
  estOut: string;
  minOut: string;
  fee: string;
  usd: string;
  route: Route;
  partner: string | null;
  target: Target | null;
  /** What the target answered; "sending" while the payment is in flight. */
  result: (Paid & { state: "paid" }) | { state: "sending"; at: number } | null;
  payer: string | null;
  recipient: string | null;
  status: OrderStatus;
  paidTx: string | null;
  feeTaken: string | null;
  outAmount: string | null;
  payoutTx: string | null;
  partnerTx: string | null;
  refundTx: string | null;
  attempts: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface OrderEvent {
  orderId: string;
  kind: string;
  detail: Record<string, unknown> | null;
  tx: string | null;
  at: number;
}

/** A settled payment that couldn't be applied to its order, waiting to be sent back. */
export interface Orphan {
  id: number;
  orderId: string | null;
  payer: string;
  currency: CurrencyCode;
  amount: string;
  tx: string | null;
  reason: string;
  /** unconfirmed: the facilitator broadcast it but couldn't confirm; the worker reads the receipt. */
  status: "unconfirmed" | "applied" | "void" | "pending" | "refunding" | "refunded" | "failed";
  at: number;
}

export interface Partner {
  code: string;
  address: string;
  name: string;
  shareBps: number;
  createdAt: number;
}

export interface BuyCall {
  orderId: string | null;
  service: string;
  url: string;
  amount: string;
  token: string;
  tx: string | null;
  at: number;
}

export const SCHEMA = `
create table if not exists hits (
  key text primary key,
  window_start bigint not null,
  count integer not null
);
create table if not exists locks (
  name text primary key,
  until bigint not null,
  owner text
);
create table if not exists nonces (
  nonce text primary key,
  address text not null,
  expires_at bigint not null
);
create table if not exists rates (
  key text primary key,
  value jsonb not null,
  at bigint not null
);
create table if not exists partners (
  code text primary key,
  address text not null,
  name text not null,
  share_bps integer not null,
  created_at bigint not null
);
create index if not exists partners_address on partners(address);
create table if not exists quotes (
  id text primary key,
  from_code text not null,
  to_code text not null,
  amount_in text not null,
  est_out text not null,
  min_out text not null,
  fee text not null,
  usd text not null,
  route jsonb not null,
  partner text,
  expires_at bigint not null,
  created_at bigint not null
);
create table if not exists orders (
  id text primary key,
  quote_id text not null,
  from_code text not null,
  to_code text not null,
  amount_in text not null,
  est_out text not null,
  min_out text not null,
  fee text not null,
  usd text not null,
  route jsonb not null,
  partner text,
  payer text,
  recipient text,
  status text not null,
  paid_tx text,
  fee_taken text,
  out_amount text,
  payout_tx text,
  partner_tx text,
  refund_tx text,
  attempts integer not null default 0,
  error text,
  created_at bigint not null,
  updated_at bigint not null
);
create index if not exists orders_status on orders(status);
create index if not exists orders_payer on orders(payer);
create index if not exists orders_recipient on orders(recipient);
create index if not exists orders_partner on orders(partner);
alter table quotes add column if not exists target jsonb;
alter table orders add column if not exists target jsonb;
alter table orders add column if not exists result jsonb;
create table if not exists events (
  id serial primary key,
  order_id text not null,
  kind text not null,
  detail jsonb,
  tx text,
  at bigint not null
);
create index if not exists events_order on events(order_id);
create table if not exists orphans (
  id serial primary key,
  order_id text,
  payer text not null,
  currency text not null,
  amount text not null,
  tx text,
  reason text not null,
  status text not null,
  refund_tx text,
  at bigint not null
);
create unique index if not exists orphans_tx on orphans(tx);
create table if not exists buy_calls (
  id serial primary key,
  order_id text,
  service text not null,
  url text not null,
  amount text not null,
  token text not null,
  tx text,
  at bigint not null
);
`;

const json = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
const str = (v: unknown) => (v == null ? null : String(v));

const toQuote = (r: Row): Quote => ({
  id: r.id as string,
  from: r.from_code as CurrencyCode,
  to: r.to_code as CurrencyCode,
  amountIn: r.amount_in as string,
  estOut: r.est_out as string,
  minOut: r.min_out as string,
  fee: r.fee as string,
  usd: r.usd as string,
  route: json(r.route) as Route,
  partner: str(r.partner),
  target: r.target ? (json(r.target) as Target) : null,
  expiresAt: Number(r.expires_at),
  createdAt: Number(r.created_at),
});

const toOrder = (r: Row): Order => ({
  id: r.id as string,
  quoteId: r.quote_id as string,
  from: r.from_code as CurrencyCode,
  to: r.to_code as CurrencyCode,
  amountIn: r.amount_in as string,
  estOut: r.est_out as string,
  minOut: r.min_out as string,
  fee: r.fee as string,
  usd: r.usd as string,
  route: json(r.route) as Route,
  partner: str(r.partner),
  target: r.target ? (json(r.target) as Target) : null,
  result: r.result ? (json(r.result) as Order["result"]) : null,
  payer: str(r.payer),
  recipient: str(r.recipient),
  status: r.status as OrderStatus,
  paidTx: str(r.paid_tx),
  feeTaken: str(r.fee_taken),
  outAmount: str(r.out_amount),
  payoutTx: str(r.payout_tx),
  partnerTx: str(r.partner_tx),
  refundTx: str(r.refund_tx),
  attempts: Number(r.attempts ?? 0),
  error: str(r.error),
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});

const toPartner = (r: Row): Partner => ({
  code: r.code as string,
  address: r.address as string,
  name: r.name as string,
  shareBps: Number(r.share_bps),
  createdAt: Number(r.created_at),
});

const COLUMNS = {
  status: "status",
  route: "route",
  payer: "payer",
  recipient: "recipient",
  paidTx: "paid_tx",
  feeTaken: "fee_taken",
  outAmount: "out_amount",
  payoutTx: "payout_tx",
  partnerTx: "partner_tx",
  refundTx: "refund_tx",
  attempts: "attempts",
  error: "error",
  result: "result",
} as const;

type OrderPatch = Partial<Pick<Order, keyof typeof COLUMNS>>;

export class Store {
  constructor(private db: Db) {}

  // Two instances booting on an empty database can race on the same "create if not exists";
  // Postgres lets one win and the other just goes again.
  async migrate(): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        for (const stmt of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) await this.db.query(stmt);
        return;
      } catch (err) {
        if (attempt === 3 || (err as { code?: string }).code !== "23505") throw err;
        await new Promise((r) => setTimeout(r, 300 * attempt));
      }
    }
  }

  /** Fixed-window counter. Returns false once `key` has been hit `limit` times in the window. */
  async hit(key: string, limit: number, windowMs: number): Promise<boolean> {
    const now = Date.now();
    const [r] = await this.db.query<{ count: number }>(
      `insert into hits (key, window_start, count) values ($1, $2, 1)
       on conflict (key) do update set
         count = case when hits.window_start < $2 - $3 then 1 else hits.count + 1 end,
         window_start = case when hits.window_start < $2 - $3 then $2 else hits.window_start end
       returning count`,
      [key, now, windowMs],
    );
    return Number(r.count) <= limit;
  }

  /**
   * A lease so two instances never act on the same order or share the wallet's nonce.
   * Returns a token for unlock, or null when someone else holds it.
   */
  async lock(name: string, ttlMs: number): Promise<string | null> {
    const now = Date.now();
    const owner = randomUUID();
    const rows = await this.db.query(
      `insert into locks (name, until, owner) values ($1, $2, $4)
       on conflict (name) do update set until = $2, owner = $4 where locks.until < $3
       returning name`,
      [name, now + ttlMs, now, owner],
    );
    return rows.length === 1 ? owner : null;
  }

  /** Only the holder can release, so a run that outlived its lease can't free someone else's. */
  async unlock(name: string, owner: string): Promise<void> {
    await this.db.query("delete from locks where name = $1 and owner = $2", [name, owner]);
  }

  async saveNonce(nonce: string, address: string, ttlMs: number): Promise<void> {
    await this.db.query("delete from nonces where expires_at < $1", [Date.now()]);
    await this.db.query("insert into nonces (nonce, address, expires_at) values ($1, $2, $3)", [nonce, address.toLowerCase(), Date.now() + ttlMs]);
  }

  async consumeNonce(nonce: string, address: string): Promise<boolean> {
    const rows = await this.db.query("delete from nonces where nonce = $1 and address = $2 and expires_at >= $3 returning nonce", [
      nonce,
      address.toLowerCase(),
      Date.now(),
    ]);
    return rows.length === 1;
  }

  async getRate<T>(key: string): Promise<{ value: T; at: number } | null> {
    const [r] = await this.db.query("select value, at from rates where key = $1", [key]);
    return r ? { value: json(r.value) as T, at: Number(r.at) } : null;
  }

  async setRate(key: string, value: unknown): Promise<void> {
    await this.db.query("insert into rates (key, value, at) values ($1, $2, $3) on conflict (key) do update set value = $2, at = $3", [
      key,
      JSON.stringify(value),
      Date.now(),
    ]);
  }

  async createPartner(p: Omit<Partner, "createdAt">): Promise<Partner> {
    await this.db.query("insert into partners (code, address, name, share_bps, created_at) values ($1, $2, $3, $4, $5)", [
      p.code,
      p.address.toLowerCase(),
      p.name,
      p.shareBps,
      Date.now(),
    ]);
    return (await this.partner(p.code))!;
  }

  async partner(code: string): Promise<Partner | null> {
    const [r] = await this.db.query("select * from partners where code = $1", [code]);
    return r ? toPartner(r) : null;
  }

  async partnersByAddress(address: string): Promise<Partner[]> {
    return (await this.db.query("select * from partners where address = $1 order by created_at asc", [address.toLowerCase()])).map(toPartner);
  }

  async createQuote(q: Omit<Quote, "createdAt">): Promise<Quote> {
    await this.db.query(
      `insert into quotes (id, from_code, to_code, amount_in, est_out, min_out, fee, usd, route, partner, target, expires_at, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [q.id, q.from, q.to, q.amountIn, q.estOut, q.minOut, q.fee, q.usd, JSON.stringify(q.route), q.partner, q.target ? JSON.stringify(q.target) : null, q.expiresAt, Date.now()],
    );
    return (await this.quote(q.id))!;
  }

  async quote(id: string): Promise<Quote | null> {
    const [r] = await this.db.query("select * from quotes where id = $1", [id]);
    return r ? toQuote(r) : null;
  }

  async createOrder(q: Quote, id: string, recipient: string | null): Promise<Order> {
    const now = Date.now();
    await this.db.query(
      `insert into orders (id, quote_id, from_code, to_code, amount_in, est_out, min_out, fee, usd, route, partner, target, recipient, status, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'awaiting_payment', $14, $14)`,
      [id, q.id, q.from, q.to, q.amountIn, q.estOut, q.minOut, q.fee, q.usd, JSON.stringify(q.route), q.partner, q.target ? JSON.stringify(q.target) : null, recipient?.toLowerCase() ?? null, now],
    );
    return (await this.order(id))!;
  }

  async order(id: string): Promise<Order | null> {
    const [r] = await this.db.query("select * from orders where id = $1", [id]);
    return r ? toOrder(r) : null;
  }

  async ordersByWallet(address: string): Promise<Order[]> {
    const a = address.toLowerCase();
    const rows = await this.db.query(
      "select * from orders where (payer = $1 or recipient = $1) and status <> 'awaiting_payment' order by updated_at desc limit 100",
      [a],
    );
    return rows.map(toOrder);
  }

  async ordersByStatus(...statuses: OrderStatus[]): Promise<Order[]> {
    const rows = await this.db.query("select * from orders where status = any($1::text[]) order by updated_at asc limit 200", [statuses]);
    return rows.map(toOrder);
  }

  async recentOrders(limit: number): Promise<Order[]> {
    const rows = await this.db.query("select * from orders where status <> 'awaiting_payment' order by updated_at desc limit $1", [
      Math.min(200, Math.max(1, limit)),
    ]);
    return rows.map(toOrder);
  }

  async updateOrder(id: string, patch: OrderPatch): Promise<Order> {
    const keys = Object.keys(patch) as (keyof OrderPatch)[];
    if (keys.length) {
      const sets = keys.map((k, i) => `${COLUMNS[k]} = $${i + 1}`).join(", ");
      const values = keys.map((k) => {
        const v = patch[k];
        if (k === "route" || k === "result") return v == null ? null : JSON.stringify(v);
        if ((k === "payer" || k === "recipient") && typeof v === "string") return v.toLowerCase();
        return v ?? null;
      });
      await this.db.query(`update orders set ${sets}, updated_at = $${keys.length + 1} where id = $${keys.length + 2}`, [...values, Date.now(), id]);
    }
    return (await this.order(id))!;
  }

  /** Atomically moves an order out of one of the given statuses, so two runs can't both claim it. */
  async transition(id: string, from: OrderStatus | OrderStatus[], to: OrderStatus): Promise<boolean> {
    const rows = await this.db.query("update orders set status = $3, updated_at = $4 where id = $1 and status = any($2::text[]) returning id", [
      id,
      Array.isArray(from) ? from : [from],
      to,
      Date.now(),
    ]);
    return rows.length === 1;
  }

  /** Claims an order for one settled payment and records who paid and which tx, in a single step. */
  async claimPayment(id: string, payer: string, tx: string | null = null): Promise<boolean> {
    const rows = await this.db.query(
      `update orders set status = 'paid', payer = $2, paid_tx = $3, recipient = coalesce(recipient, $2), updated_at = $4
       where id = $1 and status = 'awaiting_payment' returning id`,
      [id, payer.toLowerCase(), tx, Date.now()],
    );
    return rows.length === 1;
  }

  /** Orders nobody paid for are kept a day for the quote page, then dropped. */
  async dropUnpaid(olderThanMs: number): Promise<number> {
    const rows = await this.db.query("delete from orders where status = 'awaiting_payment' and created_at < $1 returning id", [Date.now() - olderThanMs]);
    await this.db.query("delete from quotes where expires_at < $1", [Date.now() - olderThanMs]);
    return rows.length;
  }

  async addEvent(orderId: string, kind: string, detail: Record<string, unknown> | null = null, tx: string | null = null): Promise<void> {
    await this.db.query("insert into events (order_id, kind, detail, tx, at) values ($1, $2, $3, $4, $5)", [
      orderId,
      kind,
      detail ? JSON.stringify(detail) : null,
      tx,
      Date.now(),
    ]);
  }

  /** True when the facilitator lately refused to settle for lack of funds: nothing moved, and it will refuse again. */
  async gaslessDown(since: number): Promise<boolean> {
    const rows = await this.db.query("select 1 from events where kind = 'payment_refused' and at > $1 and detail::text ilike '%settlement funds%' limit 1", [since]);
    return rows.length > 0;
  }

  async events(orderId: string): Promise<OrderEvent[]> {
    const rows = await this.db.query("select * from events where order_id = $1 order by id asc", [orderId]);
    return rows.map((r) => ({
      orderId: r.order_id as string,
      kind: r.kind as string,
      detail: r.detail ? (json(r.detail) as Record<string, unknown>) : null,
      tx: str(r.tx),
      at: Number(r.at),
    }));
  }

  /** One row per settlement tx: a second record of the same tx is dropped, not refunded twice. */
  async addOrphan(o: Pick<Orphan, "orderId" | "payer" | "currency" | "amount" | "tx" | "reason">, status: Orphan["status"] = "pending"): Promise<boolean> {
    const rows = await this.db.query(
      `insert into orphans (order_id, payer, currency, amount, tx, reason, status, at) values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (tx) do nothing returning id`,
      [o.orderId, o.payer.toLowerCase(), o.currency, o.amount, o.tx, o.reason, status, Date.now()],
    );
    return rows.length === 1;
  }

  async orphans(status: Orphan["status"]): Promise<Orphan[]> {
    const rows = await this.db.query("select * from orphans where status = $1 order by id asc", [status]);
    return rows.map((r) => ({
      id: Number(r.id),
      orderId: str(r.order_id),
      payer: r.payer as string,
      currency: r.currency as CurrencyCode,
      amount: r.amount as string,
      tx: str(r.tx),
      reason: r.reason as string,
      status: r.status as Orphan["status"],
      at: Number(r.at),
    }));
  }

  /** Moves an orphan on only from the expected status, so a refund is claimed exactly once. */
  async moveOrphan(id: number, from: Orphan["status"], to: Orphan["status"], refundTx: string | null = null): Promise<boolean> {
    const rows = await this.db.query("update orphans set status = $3, refund_tx = coalesce($4, refund_tx) where id = $1 and status = $2 returning id", [id, from, to, refundTx]);
    return rows.length === 1;
  }

  async addBuyCall(c: Omit<BuyCall, "at">): Promise<void> {
    await this.db.query("insert into buy_calls (order_id, service, url, amount, token, tx, at) values ($1, $2, $3, $4, $5, $6, $7)", [
      c.orderId,
      c.service,
      c.url,
      c.amount,
      c.token,
      c.tx,
      Date.now(),
    ]);
  }

  async buyCalls(limit = 200): Promise<BuyCall[]> {
    const rows = await this.db.query("select * from buy_calls order by id desc limit $1", [limit]);
    return rows.map((r) => ({
      orderId: str(r.order_id),
      service: r.service as string,
      url: r.url as string,
      amount: r.amount as string,
      token: r.token as string,
      tx: str(r.tx),
      at: Number(r.at),
    }));
  }

  /** Micro-dollars spent on buy since `since`. */
  async buySpentSince(since: number): Promise<bigint> {
    const rows = await this.db.query<{ amount: string }>("select amount from buy_calls where at >= $1", [since]);
    return rows.reduce((sum, r) => sum + BigInt(r.amount), 0n);
  }

  /** What the public sees moving: finished conversions, the corridors, the latest few with their txs. */
  async activity() {
    const [totals] = await this.db.query(`select
      count(*) filter (where status = 'done') as done,
      count(distinct payer) filter (where status = 'done') as wallets,
      coalesce(sum(usd::numeric) filter (where status = 'done'), 0)::text as usd
      from orders`);
    const corridors = await this.db.query<{ from_code: string; to_code: string; n: string; usd: string }>(
      `select from_code, to_code, count(*)::text as n, sum(usd::numeric)::text as usd from orders
       where status = 'done' group by from_code, to_code order by count(*) desc limit 12`,
    );
    const recent = await this.db.query<Row>(
      `select id, from_code, to_code, amount_in, out_amount, usd, updated_at, payout_tx from orders
       where status = 'done' order by updated_at desc limit 10`,
    );
    return {
      done: Number(totals.done),
      wallets: Number(totals.wallets),
      usd: String(totals.usd),
      corridors: corridors.map((c) => ({ from: c.from_code as CurrencyCode, to: c.to_code as CurrencyCode, count: Number(c.n), usd: c.usd })),
      recent: recent.map((r) => ({
        id: r.id as string,
        from: r.from_code as CurrencyCode,
        to: r.to_code as CurrencyCode,
        amountIn: r.amount_in as string,
        out: str(r.out_amount),
        usd: r.usd as string,
        at: Number(r.updated_at),
        tx: str(r.payout_tx),
      })),
    };
  }

  async partnerStats(code: string) {
    const [r] = await this.db.query(
      `select count(*) filter (where status = 'done') as done, coalesce(sum(usd::numeric) filter (where status = 'done'), 0)::text as usd
       from orders where partner = $1`,
      [code],
    );
    return { done: Number(r?.done ?? 0), usd: String(r?.usd ?? "0") };
  }
}
