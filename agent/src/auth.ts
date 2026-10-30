import { randomBytes } from "node:crypto";
import { getAddress, isAddress, verifyMessage, type Hex } from "viem";
import type { Store } from "./db.js";

const TTL_MS = 10 * 60_000;

export interface SignedRequest {
  address: string;
  nonce: string;
  signature: Hex;
}

export const authMessage = (action: string, nonce: string) => `Cruce\n\nAction: ${action}\nNonce: ${nonce}`;

export async function issueNonce(store: Store, address: string): Promise<string> {
  if (!isAddress(address)) throw new Error("invalid address");
  const nonce = randomBytes(16).toString("hex");
  await store.saveNonce(nonce, address, TTL_MS);
  return nonce;
}

/** Each signature is single-use and bound to one action. */
export async function verifySigned(store: Store, action: string, req: SignedRequest): Promise<`0x${string}`> {
  if (!req || !isAddress(req.address) || typeof req.nonce !== "string" || typeof req.signature !== "string") {
    throw new Error("missing signature");
  }
  const ok = await verifyMessage({ address: req.address, message: authMessage(action, req.nonce), signature: req.signature });
  if (!ok || !(await store.consumeNonce(req.nonce, req.address))) throw new Error("invalid or expired signature");
  return getAddress(req.address);
}
