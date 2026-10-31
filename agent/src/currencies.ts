import type { Address } from "viem";

/** eip3009: gasless transferWithAuthorization. permit2: signed Permit2 transfer. */
export type PayMethod = "eip3009" | "permit2";

export interface Currency {
  code: string;
  label: string;
  fiat: string;
  locale: string;
  country: string;
  address: Address;
  decimals: number;
  method: PayMethod;
  /** EIP-712 domain, read off the token contract. */
  domain: { name: string; version: string };
  /** Dollar tokens are the hub every route passes through; local ones are what people hold. */
  kind: "dollar" | "local";
  /** Offered today. The rest show as coming once their venues have depth both ways. */
  enabled: boolean;
  /** Whether Celo's x402 facilitator settles payments in it. Some can only be received. */
  payIn: boolean;
}

// Celo mainnet. Match on address, never on symbol.
export const CURRENCIES = {
  wARS: {
    code: "wARS", label: "wARS", fiat: "ARS", locale: "es-AR", country: "AR",
    address: "0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D", decimals: 18, method: "permit2",
    domain: { name: "Peso Argentino", version: "1" }, kind: "local", enabled: true, payIn: true,
  },
  wBRL: {
    code: "wBRL", label: "wBRL", fiat: "BRL", locale: "pt-BR", country: "BR",
    address: "0xD76f5Faf6888e24D9F04Bf92a0c8B921FE4390e0", decimals: 18, method: "permit2",
    domain: { name: "Real Brasileño", version: "1" }, kind: "local", enabled: true, payIn: true,
  },
  wCOP: {
    code: "wCOP", label: "wCOP", fiat: "COP", locale: "es-CO", country: "CO",
    address: "0x8a1D45e102e886510e891d2Ec656a708991e2D76", decimals: 18, method: "permit2",
    domain: { name: "Peso Colombiano", version: "1" }, kind: "local", enabled: true, payIn: true,
  },
  wMXN: {
    code: "wMXN", label: "wMXN", fiat: "MXN", locale: "es-MX", country: "MX",
    address: "0x337E7456B420bD3481e7FA61fA9850343d610d34", decimals: 18, method: "permit2",
    domain: { name: "Peso Mexicano", version: "1" }, kind: "local", enabled: false, payIn: true,
  },
  wCLP: {
    code: "wCLP", label: "wCLP", fiat: "CLP", locale: "es-CL", country: "CL",
    address: "0x61D450a098b6a7f69fC4b98CE68198fe59768651", decimals: 18, method: "permit2",
    domain: { name: "Peso Chileno", version: "1" }, kind: "local", enabled: false, payIn: true,
  },
  wPEN: {
    code: "wPEN", label: "wPEN", fiat: "PEN", locale: "es-PE", country: "PE",
    address: "0x4F34c8b3b5FB6D98Da888F0feA543d4d9C9F2eBE", decimals: 18, method: "permit2",
    domain: { name: "Sol Peruano", version: "1" }, kind: "local", enabled: false, payIn: true,
  },
  cNGN: {
    code: "cNGN", label: "cNGN", fiat: "NGN", locale: "en-NG", country: "NG",
    address: "0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f", decimals: 6, method: "permit2",
    domain: { name: "cNGN", version: "1" }, kind: "local", enabled: true, payIn: true,
  },
  IDRX: {
    code: "IDRX", label: "IDRX", fiat: "IDR", locale: "id-ID", country: "ID",
    address: "0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22", decimals: 2, method: "eip3009",
    domain: { name: "IDRX", version: "1" }, kind: "local", enabled: true, payIn: false,
  },
  USAT: {
    code: "USAT", label: "USA₮", fiat: "USD", locale: "en-US", country: "US",
    address: "0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771", decimals: 6, method: "eip3009",
    domain: { name: "Tether America USD", version: "1" }, kind: "dollar", enabled: true, payIn: true,
  },
  USDT: {
    code: "USDT", label: "USD₮", fiat: "USD", locale: "en-US", country: "US",
    address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", decimals: 6, method: "eip3009",
    domain: { name: "Tether USD", version: "1" }, kind: "dollar", enabled: true, payIn: true,
  },
  USDC: {
    code: "USDC", label: "USDC", fiat: "USD", locale: "en-US", country: "US",
    address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", decimals: 6, method: "eip3009",
    domain: { name: "USDC", version: "2" }, kind: "dollar", enabled: true, payIn: true,
  },
} as const satisfies Record<string, Currency>;

export type CurrencyCode = keyof typeof CURRENCIES;
export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];
export const ENABLED = CURRENCY_CODES.filter((c) => CURRENCIES[c].enabled);
/** Every route is priced through USD₮; USDC is the second hub for the pools that only pair with it. */
export const HUBS: CurrencyCode[] = ["USDT", "USDC"];

export function isCurrency(v: unknown): v is CurrencyCode {
  return typeof v === "string" && v in CURRENCIES;
}

export const byAddress = (address: string): CurrencyCode | undefined =>
  CURRENCY_CODES.find((c) => CURRENCIES[c].address.toLowerCase() === address.toLowerCase());
