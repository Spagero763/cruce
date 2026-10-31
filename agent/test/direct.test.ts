import { encodeFunctionData, erc20Abi, type Hex, type TransactionReceipt } from "viem";
import { describe, expect, it } from "vitest";
import { CURRENCIES } from "../src/currencies.js";
import type { Order } from "../src/db.js";
import { checkDirect } from "../src/payments.js";
import { AGENT, PAYER } from "./fakes.js";

const ID = `0x${"ab".repeat(32)}` as Hex;
const OTHER = `0x${"cd".repeat(32)}` as Hex;
const order = { id: ID, from: "USDm", amountIn: "10000000000000000000" } as unknown as Order;
const token = CURRENCIES.USDm.address;
const transfer = (amount: bigint, id: Hex) =>
  (encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [AGENT, amount] }) + id.slice(2)) as Hex;

function chainWith(tx: { to: string; input: Hex } | null, receipt: { status: string } | null, delivered: bigint) {
  return {
    pub: {
      getTransaction: async () => (tx ? { ...tx, from: PAYER } : null),
      getTransactionReceipt: async () => receipt as unknown as TransactionReceipt,
    },
    received: () => ({ amount: delivered, from: [PAYER.toLowerCase()] }),
  } as never;
}

describe("paying with a plain transfer", () => {
  it("accepts a transfer of the right token that carries this order's id", async () => {
    const r = await checkDirect(chainWith({ to: token, input: transfer(10n ** 19n, ID) }, { status: "success" }, 10n ** 19n), order, "0x01" as Hex);
    expect(r).toEqual({ state: "paid", payer: PAYER.toLowerCase(), amount: (10n ** 19n).toString() });
  });

  it("refuses a transfer made for another order, whoever submits it", async () => {
    const r = await checkDirect(chainWith({ to: token, input: transfer(10n ** 19n, OTHER) }, { status: "success" }, 10n ** 19n), order, "0x01" as Hex);
    expect(r.state).toBe("invalid");
  });

  it("refuses a transfer of a different token", async () => {
    const r = await checkDirect(chainWith({ to: CURRENCIES.USDT.address, input: transfer(10n ** 19n, ID) }, { status: "success" }, 10n ** 19n), order, "0x01" as Hex);
    expect(r.state).toBe("invalid");
  });

  it("reports a short transfer so it can be sent back", async () => {
    const r = await checkDirect(chainWith({ to: token, input: transfer(10n ** 18n, ID) }, { status: "success" }, 10n ** 18n), order, "0x01" as Hex);
    expect(r).toMatchObject({ state: "short", amount: (10n ** 18n).toString() });
  });

  it("waits while the transfer isn't mined, and refuses one that failed", async () => {
    expect((await checkDirect(chainWith(null, null, 0n), order, "0x01" as Hex)).state).toBe("pending");
    expect((await checkDirect(chainWith({ to: token, input: transfer(10n ** 19n, ID) }, null, 0n), order, "0x01" as Hex)).state).toBe("pending");
    expect((await checkDirect(chainWith({ to: token, input: transfer(10n ** 19n, ID) }, { status: "reverted" }, 0n), order, "0x01" as Hex)).state).toBe("invalid");
  });
});
