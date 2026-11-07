import type { Key } from "./i18n";

// Wallets and the chain answer in their own words. These are the ones people actually hit, each
// turned into a sentence that says what to do. Order matters: the first match wins.
const KNOWN: [RegExp, Key | null][] = [
  [/reject|denied|cancel/i, null],
  [/no-wallet/, "order.noWallet"],
  [/chain.*(mismatch|switch)|wrong (chain|network)|does not match the target chain|unsupported chain|chainId/i, "err.wrongChain"],
  [/insufficient funds for|exceeds the balance of the account|intrinsic gas|fee ?currency|gas required exceeds/i, "err.noGas"],
  [/insufficient_funds|transfer amount exceeds|exceeds balance|insufficient balance/i, "err.short"],
  [/valid_before|valid_after|deadline|authorization (is )?expired/i, "err.clock"],
  [/nonce too low|replacement|underpriced|already known|pending transaction/i, "err.pending"],
  [/invalid_signature|signature/i, "err.signature"],
  [/Failed to fetch|NetworkError|Load failed|timed? ?out|ECONN|network request failed|fetch failed/i, "err.offline"],
  [/^Payment failed|unexpected_error|unknown reason|settlement funds|invalid_exact|unsupported_scheme|"nonces" reverted/i, "order.refused"],
  [/revert|ContractFunctionExecutionError|TransactionExecutionError|execution failed/i, "err.reverted"],
  [/too many requests|rate limit/i, "err.busy"],
];

// Anything with an address, a stack or a library signature in it is not for a person.
const TECHNICAL = /0x[0-9a-fA-F]{8,}|Version: |Contract Call|Request Arguments|Docs: https|\n|viem@|Error: /;

/**
 * Turns an error into one line a person can act on. Returns null for things the person did
 * themselves (closing the wallet prompt), which deserve no message at all.
 */
export function explain(e: unknown, t: (key: Key, vars?: Record<string, string | number>) => string): string | null {
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  for (const [re, key] of KNOWN) {
    if (re.test(msg)) return key && t(key);
  }
  if (msg && msg.length <= 160 && !TECHNICAL.test(msg)) return msg;
  return t("error.generic");
}
