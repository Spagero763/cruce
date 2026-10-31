import { celo, celoSepolia } from "viem/chains";
import type { Hex } from "viem";

const TAG = /^[a-z0-9_]{1,32}$/;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const network = env.NETWORK === "testnet" ? "testnet" : "mainnet";
  const chain = network === "mainnet" ? celo : celoSepolia;
  const attributionTag = env.ATTRIBUTION_TAG?.trim() || undefined;
  if (attributionTag && !TAG.test(attributionTag)) throw new Error(`ATTRIBUTION_TAG must match ${TAG}`);

  return {
    network,
    chain,
    caip2: `eip155:${chain.id}` as const,
    rpcUrl: env.CELO_RPC_URL || chain.rpcUrls.default.http[0],
    explorer: network === "mainnet" ? "https://celoscan.io" : "https://celo-sepolia.blockscout.com",
    privateKey: env.AGENT_PRIVATE_KEY?.trim() as Hex | undefined,
    // Gas in USD₮ through fee abstraction, unless told to use native CELO.
    feeCurrency: env.FEE_CURRENCY === "CELO" ? ("CELO" as const) : ("USDT" as const),
    attributionTag,
    facilitatorUrl:
      env.X402_FACILITATOR_URL || (network === "mainnet" ? "https://api.x402.celo.org" : "https://api.x402.sepolia.celo.org"),
    x402ApiKey: env.X402_API_KEY?.trim() || undefined,
    textileUrl: (env.TEXTILE_URL || "https://api.textilecredit.com/v2").replace(/\/$/, ""),
    textileApiKey: env.TEXTILE_API_KEY?.trim() || undefined,
    buyGateway: (env.BUY_GATEWAY_URL || "https://gateway.usebuy.ai").replace(/\/$/, ""),
    buyToken: (["USDT", "USDC", "USAT"].includes(env.BUY_TOKEN ?? "") ? env.BUY_TOKEN : "USDT") as "USDT" | "USDC" | "USAT",
    buyMaxUsd: Number(env.BUY_MAX_USD ?? 0.25),
    buyDailyUsd: Number(env.BUY_DAILY_USD ?? 3),
    publicUrl: (env.PUBLIC_URL || `http://localhost:${env.PORT || 8787}`).replace(/\/$/, ""),
    webOrigin: (env.WEB_ORIGIN || "http://localhost:5173").replace(/\/$/, ""),
    agentId: env.AGENT_ID ? BigInt(env.AGENT_ID) : undefined,
    /** What the agent keeps from each conversion, in basis points of the dollar leg. */
    feeBps: Number(env.FEE_BPS ?? 60),
    /** The part of the fee that goes to whoever sent the order, when a partner did. */
    partnerBps: Number(env.PARTNER_BPS ?? 20),
    /** Per-order ceiling and floor, in dollars of the hub leg. */
    maxOrderUsd: Number(env.MAX_ORDER_USD ?? 200),
    minOrderUsd: Number(env.MIN_ORDER_USD ?? 2),
    /** Paying an agent's service: smaller orders allowed, with a fixed part of the fee that covers gas. */
    minPayUsd: Number(env.MIN_PAY_USD ?? 0.01),
    payFlatUsd: Number(env.PAY_FLAT_USD ?? 0.02),
    /** How long a quote stays good for, and how far the fill may land under it. */
    quoteTtlMs: Number(env.QUOTE_TTL_SECONDS ?? 45) * 1000,
    slippageBps: Number(env.SLIPPAGE_BPS ?? 50),
    /** Quotes further than this from the reference rate are refused rather than served. */
    maxDriftBps: Number(env.MAX_DRIFT_BPS ?? 800),
    // A serverless run has a hard time limit; the worker stops early enough to finish cleanly.
    workerBudgetMs: Number(env.WORKER_BUDGET_MS ?? 240_000),
    databaseUrl: env.DATABASE_URL || env.POSTGRES_URL || undefined,
    workerSecret: env.WORKER_SECRET || "",
    adminAddress: env.ADMIN_ADDRESS?.trim().toLowerCase() || undefined,
    port: Number(env.PORT || 8787),
  };
}

export type Config = ReturnType<typeof loadConfig>;
