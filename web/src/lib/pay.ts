import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import type { Address, PublicClient, WalletClient } from "viem";
import type { AppConfig, Order } from "./api";

/** Why a paid retry was refused: the facilitator's reason rides in the PAYMENT-REQUIRED header. */
async function refusal(res: Response): Promise<string | null> {
  const header = res.headers.get("payment-required");
  if (header) {
    try {
      const decoded = JSON.parse(atob(header)) as { error?: string };
      if (decoded.error) return decoded.error;
    } catch {
      // fall through to the body
    }
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? null;
}

// The payment client stamps authorisations with the device clock. A phone set an hour off would
// sign something already expired, so when the device and the server disagree, sign on server time.
async function clockOffset(origin: string): Promise<number> {
  try {
    const sent = Date.now();
    const res = await fetch(`${origin}/api/health`, { cache: "no-store" });
    const { now } = (await res.json()) as { now?: number };
    if (typeof now !== "number") return 0;
    return now + (Date.now() - sent) / 2 - Date.now();
  } catch {
    return 0;
  }
}

async function onServerClock<T>(offset: number, fn: () => Promise<T>): Promise<T> {
  if (Math.abs(offset) < 60_000) return fn();
  const real = Date.now;
  Date.now = () => real() + offset;
  try {
    return await fn();
  } finally {
    Date.now = real;
  }
}

/**
 * Pays with a plain token transfer, for currencies Celo's x402 facilitator doesn't settle. The
 * order id rides at the end of the calldata, so the transfer can only ever pay this order.
 */
export async function payByTransfer(opts: { order: Order; config: AppConfig; wallet: WalletClient; pub: PublicClient; address: Address; report: (tx: string) => Promise<boolean> }): Promise<string> {
  const { order, config, wallet, pub, address } = opts;
  const currency = config.currencies.find((c) => c.code === order.from);
  if (!currency) throw new Error("unsupported currency");
  const { encodeFunctionData, erc20Abi } = await import("viem");
  const data = (encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [config.agent, BigInt(order.amountIn)] }) + order.id.slice(2)) as `0x${string}`;
  const hash = await wallet.sendTransaction({ account: wallet.account ?? address, chain: wallet.chain, to: currency.address, data } as never);
  await pub.waitForTransactionReceipt({ hash });
  // The agent may see the receipt a moment after the wallet does, so it is asked a few times.
  for (let i = 0; i < 20; i++) {
    if (await opts.report(hash)) return hash;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return hash;
}

/** One signature, settled by Celo's facilitator. The payer pays no gas. */
export async function payOrder(opts: {
  payUrl: string;
  order: Order;
  config: AppConfig;
  wallet: WalletClient;
  pub: PublicClient;
  address: Address;
}): Promise<{ transaction: string | null; order: Order | null }> {
  const { payUrl, order, config, wallet, pub, address } = opts;
  const currency = config.currencies.find((c) => c.code === order.from);
  if (!currency) throw new Error("unsupported currency");

  const signer = {
    address,
    signTypedData: (m: { domain: Record<string, unknown>; types: Record<string, unknown>; primaryType: string; message: Record<string, unknown> }) =>
      wallet.signTypedData({ account: wallet.account ?? address, ...m } as never),
    readContract: (a: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }) =>
      pub.readContract(a as never),
  };

  const network = `eip155:${config.chainId}` as const;
  const client = new x402Client();
  client.register(network, new ExactEvmScheme(signer as never) as never);
  client.setSpendControls({
    maxAmountPerPayment: false,
    allowedAssets: [{ network, asset: currency.address, maxAmountPerPayment: order.amountIn }],
  });

  const offset = await clockOffset(new URL(payUrl, location.href).origin);
  const res = await onServerClock(offset, () => wrapFetchWithPayment(fetch, client)(payUrl, { method: "POST" }));
  if (!res.ok) throw new Error((await refusal(res)) ?? `Payment failed (${res.status})`);
  const receipt = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
  try {
    return { transaction: receipt ? (JSON.parse(atob(receipt)).transaction ?? null) : null, order: null };
  } catch {
    return { transaction: null, order: null };
  }
}
