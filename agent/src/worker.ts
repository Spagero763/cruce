import { getAddress, type Hex } from "viem";
import { NotSent, type Chain } from "./chain.js";
import type { Config } from "./config.js";
import type { Store } from "./db.js";
import { RUNNING, type Engine } from "./engine.js";
import { applyPayment } from "./payments.js";
import type { Rates } from "./rates.js";

// A broadcast tx that hasn't landed after this long was dropped by the network.
const UNCONFIRMED_GIVE_UP_MS = 60 * 60_000;
/** An order nobody has touched for this long had its instance die; the worker picks it up. */
export const STALL_MS = 90_000;
const UNPAID_KEEP_MS = 86_400_000;
// A send can hold the wallet lease for a couple of minutes, so none starts this close to the deadline.
const SEND_MARGIN_MS = 150_000;

/** One round: finish stalled orders, confirm and return stray payments, refresh the reference rates. */
export function createWorker(cfg: Config, store: Store, chain: Chain, engine: Engine, rates: Rates, log = console) {
  async function resume(now: number, stopAt: number): Promise<number> {
    let resumed = 0;
    for (const order of await store.ordersByStatus(...RUNNING)) {
      if (Date.now() > stopAt - SEND_MARGIN_MS) break;
      if (now - order.updatedAt < STALL_MS) continue;
      const after = await engine.run(order.id);
      if (after && after.status !== order.status) resumed++;
    }
    return resumed;
  }

  // Payments the facilitator broadcast but couldn't confirm: once the receipt is in, they are
  // applied like any other, or sent back if their order was paid another way meanwhile.
  async function confirmUnconfirmed(now: number, stopAt: number): Promise<number> {
    let confirmed = 0;
    for (const o of await store.orphans("unconfirmed")) {
      const landed = await chain.transferLanded(o.tx as Hex, o.currency, BigInt(o.amount));
      if (landed === "pending") {
        if (now - o.at > UNCONFIRMED_GIVE_UP_MS) await store.moveOrphan(o.id, "unconfirmed", "void");
        continue;
      }
      if (landed === "reverted") {
        await store.moveOrphan(o.id, "unconfirmed", "void");
        continue;
      }
      const order = o.orderId ? await store.order(o.orderId) : null;
      const outcome = await applyPayment(store, order, { payer: o.payer, currency: o.currency, amount: o.amount, tx: o.tx });
      if (outcome === "applied" || outcome === "duplicate") {
        await store.moveOrphan(o.id, "unconfirmed", "applied");
        confirmed++;
        if (outcome === "applied" && Date.now() < stopAt - SEND_MARGIN_MS) await engine.run(order!.id);
      } else {
        await store.moveOrphan(o.id, "unconfirmed", "pending");
        if (order) await store.addEvent(order.id, "extra_payment", null, o.tx);
      }
    }
    return confirmed;
  }

  async function refundOrphans(stopAt: number): Promise<number> {
    let refunded = 0;
    for (const o of await store.orphans("pending")) {
      if (Date.now() > stopAt - SEND_MARGIN_MS) break;
      if (!(await store.moveOrphan(o.id, "pending", "refunding"))) continue;
      try {
        const { hash } = await chain.transfer(o.currency, getAddress(o.payer), BigInt(o.amount));
        await store.moveOrphan(o.id, "refunding", "refunded", hash);
        if (o.orderId) await store.addEvent(o.orderId, "extra_refunded", null, hash);
        refunded++;
      } catch (err) {
        if (err instanceof NotSent) {
          await store.moveOrphan(o.id, "refunding", "pending");
          continue;
        }
        // Not retried: the transfer may have gone out anyway. A person checks it.
        await store.moveOrphan(o.id, "refunding", "failed");
        log.error("[orphan]", o.id, err);
      }
    }
    return refunded;
  }

  return {
    async tick(): Promise<{ resumed: number; confirmed: number; refunded: number; rates: number; skipped?: boolean }> {
      const lease = await store.lock("worker", 300_000);
      if (!lease) return { resumed: 0, confirmed: 0, refunded: 0, rates: 0, skipped: true };
      try {
        const now = Date.now();
        const stopAt = now + cfg.workerBudgetMs;
        const resumed = await resume(now, stopAt).catch((err) => (log.error("[resume]", err), 0));
        const confirmed = await confirmUnconfirmed(now, stopAt).catch((err) => (log.error("[unconfirmed]", err), 0));
        const refunded = await refundOrphans(stopAt).catch((err) => (log.error("[orphans]", err), 0));
        await store.dropUnpaid(UNPAID_KEEP_MS).catch(() => 0);
        await rates.reference().catch(() => null);
        const read = await rates.refreshStreet().catch((err) => (log.error("[rates]", err), 0));
        return { resumed, confirmed, refunded, rates: read };
      } finally {
        await store.unlock("worker", lease);
      }
    },
  };
}
