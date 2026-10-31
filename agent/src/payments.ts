// Paying for a conversion over x402. The payer signs one authorisation for the exact input,
// Celo's facilitator settles it to the agent's wallet, and the agent runs the order from there.
import { HTTPFacilitatorClient, type HTTPRequestContext, type RoutesConfig } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { declareEip2612GasSponsoringExtension } from "@x402/extensions";
import { BUILDER_CODE, declareBuilderCodeExtension } from "@x402/extensions/builder-code";
import { x402ResourceServer } from "@x402/hono";
import type { Hex } from "viem";
import type { Chain } from "./chain.js";
import type { Config } from "./config.js";
import { byAddress, CURRENCIES, type CurrencyCode } from "./currencies.js";
import type { Order, Store } from "./db.js";
import type { Engine } from "./engine.js";

export const PAY_ROUTE = "/x402/orders/:id/pay";
const ORDER_IN_PATH = /^\/x402\/orders\/(0x[0-9a-fA-F]{64})\/pay$/;

export function orderIdFromPath(path: string): Hex | null {
  return (path.match(ORDER_IN_PATH)?.[1] as Hex | undefined) ?? null;
}

interface Settled {
  payer: string;
  currency: CurrencyCode;
  amount: string;
  tx: string | null;
}

export type Applied = "applied" | "duplicate" | "no_order" | "mismatch" | "already_paid";

/**
 * Applies one settled payment to its order. Shared by the settlement hook and the worker, which
 * confirms payments the facilitator broadcast but couldn't report back. Anything but "applied"
 * or "duplicate" is money the caller has to send back.
 */
export async function applyPayment(store: Store, order: Order | null, s: Settled): Promise<Applied> {
  if (!order) return "no_order";
  if (order.from !== s.currency || BigInt(order.amountIn) !== BigInt(s.amount)) return "mismatch";
  // Claimed in one step, so two settlements for the same order can't both proceed.
  if (!(await store.claimPayment(order.id, s.payer, s.tx))) {
    // The same tx reported twice is one payment, not an extra one.
    return s.tx && (await store.order(order.id))?.paidTx === s.tx ? "duplicate" : "already_paid";
  }
  await store.addEvent(order.id, "paid", { payer: s.payer, currency: s.currency, amount: order.amountIn }, s.tx);
  return "applied";
}

export function createPayments(cfg: Config, store: Store, chain: Chain, engine: Engine) {
  const facilitator = new HTTPFacilitatorClient({
    url: cfg.facilitatorUrl,
    createAuthHeaders: async () => {
      const h: Record<string, string> = cfg.x402ApiKey ? { "X-API-Key": cfg.x402ApiKey } : {};
      return { verify: h, settle: h, supported: h };
    },
  });

  const server = new x402ResourceServer(facilitator).register(cfg.caip2, new ExactEvmScheme());

  const price = async (ctx: HTTPRequestContext) => {
    const id = orderIdFromPath(ctx.path);
    const order = id ? await store.order(id) : null;
    if (!order || order.status !== "awaiting_payment") throw new Error("order is not awaiting payment");
    const c = CURRENCIES[order.from];
    return { amount: order.amountIn, asset: c.address, extra: { ...c.domain, assetTransferMethod: c.method } };
  };

  const routes: RoutesConfig = {
    [`POST ${PAY_ROUTE}`]: {
      accepts: { scheme: "exact", network: cfg.caip2, payTo: chain.address, price, maxTimeoutSeconds: 300 },
      description: "Pay for a Cruce conversion. The agent changes it and sends the result to the recipient.",
      mimeType: "application/json",
      // The facilitator sponsors the wFIAT permit to Permit2 only when the 402 body declares this.
      extensions: {
        ...declareEip2612GasSponsoringExtension(),
        ...(cfg.attributionTag ? { [BUILDER_CODE]: declareBuilderCodeExtension(cfg.attributionTag) } : {}),
      },
    },
  };

  // The order comes from the path that was priced, never from the payload: the client writes the
  // payload's resource field, so trusting it would let one payment run another order.
  const pathOf = (ctx: { transportContext?: unknown }) => (ctx.transportContext as { request?: { path?: string } } | undefined)?.request?.path ?? "";

  const signerOf = (payload: { payload?: unknown }) => {
    const p = payload.payload as { authorization?: { from?: string }; permit2Authorization?: { from?: string } } | undefined;
    return p?.authorization?.from ?? p?.permit2Authorization?.from ?? null;
  };

  server.onAfterSettle(async (ctx) => {
    const { requirements: req, result } = ctx;
    const payer = result.payer;
    const tx = result.transaction || null;
    const record = { payer, asset: req.asset, amount: req.amount, payTo: req.payTo, tx };
    try {
      if (!payer || req.payTo.toLowerCase() !== chain.address.toLowerCase()) throw new Error("settled somewhere else");
      const currency = byAddress(req.asset);
      if (!currency) throw new Error("unknown asset");
      const id = orderIdFromPath(pathOf(ctx));
      const order = id ? await store.order(id) : null;
      const outcome = await applyPayment(store, order, { payer, currency, amount: req.amount, tx });
      if (outcome === "applied") {
        await engine.run(order!.id);
        return;
      }
      if (outcome === "duplicate") return;
      const recorded = await store.addOrphan({ orderId: order?.id ?? null, payer, currency, amount: req.amount, tx, reason: outcome });
      if (recorded && order) await store.addEvent(order.id, "extra_payment", null, tx);
    } catch (err) {
      // The library swallows hook errors, so this line is the record of money that arrived.
      console.error("[settle] payment not applied", JSON.stringify(record), err);
    }
  });

  // A settlement the facilitator broadcast but couldn't confirm in time still moves the money.
  // It is written down now and the worker applies it once the receipt is in.
  server.onSettleFailure(async (ctx) => {
    const { requirements: req, error } = ctx;
    const tx = (error as { transaction?: string }).transaction || null;
    const payer = signerOf(ctx.paymentPayload as { payload?: unknown });
    const currency = byAddress(req.asset);
    if (!tx || !payer || !currency || req.payTo.toLowerCase() !== chain.address.toLowerCase()) return;
    const id = orderIdFromPath(pathOf(ctx));
    await store.addOrphan({ orderId: id, payer, currency, amount: req.amount, tx, reason: "unconfirmed_settlement" }, "unconfirmed");
  });

  return { server, routes };
}

export type Direct =
  | { state: "pending" }
  | { state: "invalid"; reason: string }
  | { state: "short"; payer: string; amount: string }
  | { state: "paid"; payer: string; amount: string };

/**
 * Checks a plain token transfer to the agent as payment for an order. It counts only when the
 * transaction's calldata ends with the order id, so a transfer made for one order can never be
 * claimed by another, whoever submits its hash.
 */
export async function checkDirect(chain: Pick<Chain, "pub" | "received">, order: Order, hash: Hex): Promise<Direct> {
  const tx = await chain.pub.getTransaction({ hash }).catch(() => null);
  if (!tx) return { state: "pending" };
  const token = CURRENCIES[order.from].address.toLowerCase();
  if (tx.to?.toLowerCase() !== token) return { state: "invalid", reason: "that transaction isn't a transfer of the currency this order is paid in" };
  if (!tx.input.toLowerCase().endsWith(order.id.slice(2).toLowerCase())) return { state: "invalid", reason: "that transfer wasn't made for this order" };
  const receipt = await chain.pub.getTransactionReceipt({ hash }).catch(() => null);
  if (!receipt) return { state: "pending" };
  if (receipt.status !== "success") return { state: "invalid", reason: "that transfer failed on-chain" };
  const got = chain.received(receipt, order.from);
  const payer = tx.from.toLowerCase();
  if (got.amount < BigInt(order.amountIn)) return { state: "short", payer, amount: got.amount.toString() };
  return { state: "paid", payer, amount: got.amount.toString() };
}
