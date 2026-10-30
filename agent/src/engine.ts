// Runs a paid order to the end: each leg on its venue, the fee, the payout, the partner's share.
// Every step writes its transaction hash down before waiting for it, and the whole thing can
// be picked up again from any point, so a crash mid-order never loses track of money.
import { getAddress, type Address, type Hex } from "viem";
import { NotSent, Reverted, type Chain } from "./chain.js";
import type { Config } from "./config.js";
import { CURRENCIES, type CurrencyCode } from "./currencies.js";
import type { Order, Store } from "./db.js";
import type { Textile } from "./textile.js";
import { poolsFor, V4_ROUTER, type Uniswap } from "./uniswap.js";
import type { Leg, PoolRef } from "./types.js";

/** A transaction is still in the mempool; the order is left alone until it lands. */
export class Waiting extends Error {}
/** Nothing moved; another venue or a later try may do better. */
export class Retry extends Error {}

export const MAX_ATTEMPTS = 4;
export const RUNNING = ["paid", "swapping", "paying_out"] as const;

interface Got {
  amount: bigint;
  from: string[];
}

export interface Venues {
  textile: Pick<Textile, "firm" | "submit" | "cancel">;
  uniswap: Pick<Uniswap, "quote" | "build">;
}

export type Engine = ReturnType<typeof createEngine>;

export function createEngine(cfg: Config, store: Store, chain: Chain, venues: Venues, log = console) {
  const feeOf = (amount: bigint) => (amount * BigInt(cfg.feeBps)) / 10_000n;
  const under = (amount: bigint) => (amount * BigInt(10_000 - cfg.slippageBps)) / 10_000n;

  /** The only entry point. One run per order at a time; anything else sees the current state. */
  async function run(id: string): Promise<Order | null> {
    const name = `order:${id}`;
    const lease = await store.lock(name, 240_000);
    if (!lease) return store.order(id);
    try {
      let order = await store.order(id);
      if (!order || !(RUNNING as readonly string[]).includes(order.status)) return order;
      try {
        order = await legs(order);
        order = await payout(order);
      } catch (err) {
        if (err instanceof Waiting) return store.order(id);
        order = await failed(order, err);
      }
      return order;
    } finally {
      await store.unlock(name, lease);
    }
  }

  async function legs(order: Order): Promise<Order> {
    const route = structuredClone(order.route);
    if (order.status === "paid") await store.transition(order.id, "paid", "swapping");
    let feeTaken = order.feeTaken ? BigInt(order.feeTaken) : null;
    const save = async () => {
      order = await store.updateOrder(order.id, { route, feeTaken: feeTaken?.toString() ?? null });
    };

    for (let i = 0; i < route.legs.length; i++) {
      const leg = route.legs[i];
      if (leg.out != null) continue;
      let amountIn = i === 0 ? BigInt(order.amountIn) : BigInt(route.legs[i - 1].out!);
      if (route.feeLeg === i) {
        feeTaken ??= feeOf(amountIn);
        amountIn -= feeTaken;
      }
      if (leg.tx) {
        const { status, receipt } = await chain.outcome(leg.tx as Hex);
        if (status === "pending") throw new Waiting();
        if (status === "success" && receipt) {
          const got = chain.received(receipt, leg.to);
          await landed(order, i, leg, got);
          await save();
          continue;
        }
        leg.tx = null;
        await save();
      }
      const last = i === route.legs.length - 1;
      const minOut = last ? lastLegMin(order) : under(BigInt(leg.quotedOut));
      const got = await fill(order, leg, amountIn, minOut, async (hash) => {
        leg.tx = hash;
        await save();
      });
      await landed(order, i, leg, got);
      await save();
    }
    return order;
  }

  /** What the last leg must deliver. When the fee comes off the final amount, the leg has to cover it too. */
  function lastLegMin(order: Order): bigint {
    const minOut = BigInt(order.minOut);
    if (order.route.feeLeg !== order.route.legs.length) return minOut;
    return (minOut * 10_000n) / BigInt(10_000 - cfg.feeBps) + 1n;
  }

  async function landed(order: Order, i: number, leg: Leg, got: Got) {
    if (got.amount === 0n) throw new Error(`leg ${i} landed but delivered nothing: ${leg.tx}`);
    leg.out = got.amount.toString();
    leg.counterparties = [...new Set([...(leg.counterparties ?? []), ...got.from])];
    await store.addEvent(order.id, "leg", { i, venue: leg.venue, from: leg.from, to: leg.to, in: leg.quotedIn, out: leg.out }, leg.tx);
  }

  /** Tries the venue the quote picked first, then any other that trades the pair. */
  async function fill(order: Order, leg: Leg, amountIn: bigint, minOut: bigint, onHash: (hash: Hex) => Promise<void>): Promise<Got> {
    const tries: (() => Promise<Got>)[] = [];
    const uni = (pool: PoolRef) => () => viaUniswap(pool, leg, amountIn, minOut, onHash);
    const pools = poolsFor(leg.from, leg.to);
    if (leg.venue === "textile") {
      tries.push(() => viaTextile(leg, amountIn, minOut, onHash), ...pools.map(uni));
    } else {
      const mine = pools.find((p) => JSON.stringify(p) === JSON.stringify(leg.pool));
      tries.push(...(mine ? [uni(mine)] : []), () => viaTextile(leg, amountIn, minOut, onHash), ...pools.filter((p) => p !== mine).map(uni));
    }
    let last: unknown = null;
    for (const t of tries) {
      try {
        return await t();
      } catch (err) {
        // A broadcast that hasn't landed must not be followed by another spend of the same money.
        if (leg.tx && !(err instanceof Reverted)) throw new Waiting();
        if (err instanceof Reverted) leg.tx = null;
        if (!(err instanceof Retry) && !(err instanceof Reverted) && !(err instanceof NotSent)) throw err;
        last = err;
        log.warn(`[order ${order.id.slice(0, 10)}] ${leg.from}->${leg.to}: ${String(err).slice(0, 160)}`);
      }
    }
    throw last instanceof Error ? last : new Retry("no venue could fill this leg");
  }

  async function viaTextile(leg: Leg, amountIn: bigint, minOut: bigint, onHash: (hash: Hex) => Promise<void>): Promise<Got> {
    const sellToken = CURRENCIES[leg.from].address;
    const buyToken = CURRENCIES[leg.to].address;
    const q = await venues.textile.firm({ sellToken, buyToken, sellAmount: amountIn, taker: chain.account });
    if (q.status === "no_quote") throw new Retry(`textile: ${q.reason}`);
    if (q.buyAmount < minOut || q.takerPays > amountIn) {
      await venues.textile.cancel(q.rfqId, q.claimToken);
      throw new Retry(`textile quoted ${q.buyAmount} under the minimum ${minOut}`);
    }
    if (Date.now() > q.expiresAt - 8_000) throw new Retry("textile quote expired before it could be sent");
    await chain.ensureAllowance(leg.from, q.spender, q.takerPays);
    const sent = await chain.send({ to: q.swap.to, data: q.swap.data }, "textile swap", onHash);
    await venues.textile.submit(q.rfqId, q.claimToken, sent.hash);
    const got = chain.received(sent.receipt, leg.to);
    return { amount: got.amount, from: [...new Set([...got.from, ...q.makers.map((m) => m.toLowerCase())])] };
  }

  async function viaUniswap(pool: PoolRef, leg: Leg, amountIn: bigint, minOut: bigint, onHash: (hash: Hex) => Promise<void>): Promise<Got> {
    const quoted = await venues.uniswap.quote(pool, leg.from, leg.to, amountIn);
    if (quoted === null) throw new Retry(`uniswap ${pool.kind}: no quote`);
    if (quoted < minOut) throw new Retry(`uniswap ${pool.kind} quoted ${quoted} under the minimum ${minOut}`);
    const built = venues.uniswap.build(pool, leg.from, leg.to, amountIn, minOut, chain.address, BigInt(Math.floor(Date.now() / 1000) + 300));
    if (built.approval === "erc20") await chain.ensureAllowance(leg.from, built.spender, amountIn);
    else await chain.ensurePermit2(leg.from, V4_ROUTER, amountIn);
    const sent = await chain.send({ to: built.to, data: built.data }, `uniswap ${pool.kind} swap`, onHash);
    return chain.received(sent.receipt, leg.to);
  }

  async function payout(order: Order): Promise<Order> {
    if (order.status !== "paying_out") await store.transition(order.id, ["paid", "swapping"], "paying_out");
    const legs = order.route.legs;
    let final = BigInt(legs[legs.length - 1].out!);
    let feeTaken = order.feeTaken ? BigInt(order.feeTaken) : 0n;
    if (order.route.feeLeg === legs.length && !order.feeTaken) {
      feeTaken = feeOf(final);
      final -= feeTaken;
      order = await store.updateOrder(order.id, { feeTaken: feeTaken.toString() });
    } else if (order.route.feeLeg === legs.length) {
      final -= feeTaken;
    }
    const recipient = getAddress(order.recipient ?? order.payer!);

    if (order.payoutTx) {
      const { status } = await chain.outcome(order.payoutTx as Hex);
      if (status === "pending") throw new Waiting();
      if (status === "reverted") order = await store.updateOrder(order.id, { payoutTx: null });
    }
    if (!order.payoutTx) {
      const amount = order.outAmount ? BigInt(order.outAmount) : final;
      const sent = await chain.transfer(order.to, recipient, amount, async (hash) => {
        order = await store.updateOrder(order.id, { payoutTx: hash, outAmount: amount.toString() });
      });
      await store.addEvent(order.id, "paid_out", { to: recipient, amount: amount.toString(), currency: order.to }, sent.hash);
    }

    if (order.partner && !order.partnerTx && feeTaken > 0n) {
      const partner = await store.partner(order.partner);
      const share = (feeTaken * BigInt(Math.min(partner?.shareBps ?? 0, cfg.feeBps))) / BigInt(cfg.feeBps);
      if (partner && share > 0n) {
        const sent = await chain.transfer(order.route.feeToken, getAddress(partner.address), share, async (hash) => {
          order = await store.updateOrder(order.id, { partnerTx: hash });
        });
        await store.addEvent(order.id, "partner_paid", { partner: partner.code, amount: share.toString(), currency: order.route.feeToken }, sent.hash);
      }
    }

    await store.transition(order.id, "paying_out", "done");
    await store.addEvent(order.id, "done", { out: order.outAmount, fee: feeTaken.toString() });
    return (await store.order(order.id))!;
  }

  async function failed(order: Order, err: unknown): Promise<Order> {
    const message = String(err instanceof Error ? err.message : err).slice(0, 300);
    const attempts = order.attempts + 1;
    log.error(`[order ${order.id.slice(0, 10)}] attempt ${attempts}: ${message}`);
    if (attempts < MAX_ATTEMPTS) {
      await store.addEvent(order.id, "retry", { attempt: attempts, error: message });
      return store.updateOrder(order.id, { attempts, error: message });
    }
    return refund(await store.updateOrder(order.id, { attempts, error: message }), message);
  }

  /**
   * Gives the payer back what the order became: the token they paid when nothing was converted,
   * the dollars from the first leg otherwise. The fee is returned with it; a failed order costs nothing.
   */
  async function refund(order: Order, reason: string): Promise<Order> {
    if (!(await store.transition(order.id, [...RUNNING], "refunding"))) return order;
    const payer = getAddress(order.payer!);
    const done = order.route.legs.filter((l) => l.out != null);
    const feeTaken = order.feeTaken ? BigInt(order.feeTaken) : 0n;
    const feeToken = order.route.feeToken;
    const sends: { code: CurrencyCode; amount: bigint }[] = [];
    if (!done.length) {
      sends.push({ code: order.from, amount: BigInt(order.amountIn) });
    } else {
      const last = done[done.length - 1];
      let amount = BigInt(last.out!);
      if (feeTaken > 0n && feeToken === last.to) amount += feeTaken;
      else if (feeTaken > 0n) sends.push({ code: feeToken, amount: feeTaken });
      sends.unshift({ code: last.to, amount });
    }
    try {
      for (const s of sends) {
        const sent = await chain.transfer(s.code, payer, s.amount, async (hash) => {
          await store.updateOrder(order.id, { refundTx: hash });
        });
        await store.addEvent(order.id, "refunded", { reason, currency: s.code, amount: s.amount.toString() }, sent.hash);
      }
      await store.transition(order.id, "refunding", "refunded");
    } catch (err) {
      await store.transition(order.id, "refunding", "attention");
      await store.addEvent(order.id, "attention", { reason: "refund_failed", error: String(err).slice(0, 300) });
    }
    return (await store.order(order.id))!;
  }

  return { run, refund, address: chain.address as Address };
}
