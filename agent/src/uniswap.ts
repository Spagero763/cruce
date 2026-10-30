// Uniswap on Celo: the v3 pools that pair pesos and naira with dollars, and the v4 pools that
// only pair with USDC. Quotes come from the quoters; swaps are built as raw calldata so the
// agent's wallet can tag and send them like any other transaction.
import { encodeAbiParameters, encodeFunctionData, encodePacked, parseAbi, type Address, type Hex } from "viem";

/** The one read the quoter needs from a client. Typed loosely so any chain's client fits. */
export interface Simulator {
  simulateContract(args: any): Promise<{ result: any }>;
}
import { CURRENCIES, type CurrencyCode } from "./currencies.js";
import type { PoolRef } from "./types.js";

export const V3_QUOTER: Address = "0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8";
export const V3_ROUTER: Address = "0x5615CDAb10dc425a742d643d949a7F474C01abc4";
export const V4_QUOTER: Address = "0x28566da1093609182dff2cb2a91cfd72e61d66cd";
export const V4_ROUTER: Address = "0xcb695bc5d3aa22cad1e6df07801b061a05a0233a";
export const PERMIT2: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const NO_HOOKS: Address = "0x0000000000000000000000000000000000000000";

interface PoolEntry {
  a: CurrencyCode;
  b: CurrencyCode;
  pool: PoolRef;
}

const v4 = (a: CurrencyCode, b: CurrencyCode, fee: number, tickSpacing: number): PoolEntry => {
  const [c0, c1] = [CURRENCIES[a].address, CURRENCIES[b].address].sort((x, y) => (x.toLowerCase() < y.toLowerCase() ? -1 : 1));
  return { a, b, pool: { kind: "v4", currency0: c0, currency1: c1, fee, tickSpacing, hooks: NO_HOOKS } };
};

/** Pools with real depth, checked by hand. A pool that isn't here is not routed through. */
export const POOLS: PoolEntry[] = [
  { a: "wARS", b: "USDT", pool: { kind: "v3", fee: 100 } },
  { a: "cNGN", b: "USDT", pool: { kind: "v3", fee: 100 } },
  { a: "USDC", b: "USDT", pool: { kind: "v3", fee: 100 } },
  { a: "USAT", b: "USDT", pool: { kind: "v3", fee: 100 } },
  v4("USDC", "wBRL", 3000, 30),
  v4("wARS", "USDC", 3000, 30),
];

export const poolsFor = (from: CurrencyCode, to: CurrencyCode): PoolRef[] =>
  POOLS.filter((p) => (p.a === from && p.b === to) || (p.a === to && p.b === from)).map((p) => p.pool);

const V3_QUOTER_ABI = parseAbi([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
]);
const V3_ROUTER_ABI = parseAbi([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
]);
const V4_QUOTER_ABI = parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
]);
const V4_ROUTER_ABI = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);

// Universal Router command and v4 router actions, by their byte values.
const V4_SWAP = 0x10;
const SWAP_EXACT_IN_SINGLE = 0x06;
const SETTLE_ALL = 0x0c;
const TAKE_ALL = 0x0f;

export interface BuiltSwap {
  to: Address;
  data: Hex;
  /** Who must be allowed to pull the input: the router itself, or Permit2 with the router allowed on it. */
  spender: Address;
  approval: "erc20" | "permit2";
}

export class Uniswap {
  constructor(private pub: Simulator) {}

  /** What `amountIn` of `from` buys through `pool` right now, or null when the pool can't fill it. */
  async quote(pool: PoolRef, from: CurrencyCode, to: CurrencyCode, amountIn: bigint): Promise<bigint | null> {
    const tokenIn = CURRENCIES[from].address;
    const tokenOut = CURRENCIES[to].address;
    try {
      if (pool.kind === "v3") {
        const { result } = await this.pub.simulateContract({
          address: V3_QUOTER,
          abi: V3_QUOTER_ABI,
          functionName: "quoteExactInputSingle",
          args: [{ tokenIn, tokenOut, amountIn, fee: pool.fee, sqrtPriceLimitX96: 0n }],
        });
        return result[0];
      }
      const { result } = await this.pub.simulateContract({
        address: V4_QUOTER,
        abi: V4_QUOTER_ABI,
        functionName: "quoteExactInputSingle",
        args: [{ poolKey: poolKey(pool), zeroForOne: tokenIn.toLowerCase() === pool.currency0.toLowerCase(), exactAmount: amountIn, hookData: "0x" }],
      });
      return result[0];
    } catch {
      return null;
    }
  }

  build(pool: PoolRef, from: CurrencyCode, to: CurrencyCode, amountIn: bigint, minOut: bigint, recipient: Address, deadline: bigint): BuiltSwap {
    const tokenIn = CURRENCIES[from].address;
    const tokenOut = CURRENCIES[to].address;
    if (pool.kind === "v3") {
      const data = encodeFunctionData({
        abi: V3_ROUTER_ABI,
        functionName: "exactInputSingle",
        args: [{ tokenIn, tokenOut, fee: pool.fee, recipient, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }],
      });
      return { to: V3_ROUTER, data, spender: V3_ROUTER, approval: "erc20" };
    }
    const zeroForOne = tokenIn.toLowerCase() === pool.currency0.toLowerCase();
    const actions = encodePacked(["uint8", "uint8", "uint8"], [SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL]);
    const params: Hex[] = [
      encodeAbiParameters(
        [
          {
            type: "tuple",
            components: [
              {
                type: "tuple",
                name: "poolKey",
                components: [
                  { type: "address", name: "currency0" },
                  { type: "address", name: "currency1" },
                  { type: "uint24", name: "fee" },
                  { type: "int24", name: "tickSpacing" },
                  { type: "address", name: "hooks" },
                ],
              },
              { type: "bool", name: "zeroForOne" },
              { type: "uint128", name: "amountIn" },
              { type: "uint128", name: "amountOutMinimum" },
              { type: "bytes", name: "hookData" },
            ],
          },
        ],
        [{ poolKey: poolKey(pool), zeroForOne, amountIn, amountOutMinimum: minOut, hookData: "0x" }],
      ),
      encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [tokenIn, amountIn]),
      encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [tokenOut, minOut]),
    ];
    const input = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [actions, params]);
    const data = encodeFunctionData({
      abi: V4_ROUTER_ABI,
      functionName: "execute",
      args: [encodePacked(["uint8"], [V4_SWAP]), [input], deadline],
    });
    return { to: V4_ROUTER, data, spender: PERMIT2, approval: "permit2" };
  }
}

const poolKey = (p: Extract<PoolRef, { kind: "v4" }>) => ({
  currency0: p.currency0,
  currency1: p.currency1,
  fee: p.fee,
  tickSpacing: p.tickSpacing,
  hooks: p.hooks,
});
