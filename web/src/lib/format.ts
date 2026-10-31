import { formatUnits } from "viem";
import type { Currency } from "./api";

/** Currencies whose amounts read in whole units: nobody writes centavos on a peso price. */
const WHOLE = new Set(["ARS", "COP", "NGN", "CLP", "IDR"]);

/** "$ 33.000" for wARS, "R$ 106,66" for wBRL, "₦ 27.404" for cNGN, "US$ 20.00" for the dollars. */
export function money(amount: bigint | string, c: Currency, opts: { compact?: boolean } = {}): string {
  const value = Number(formatUnits(BigInt(amount), c.decimals));
  const whole = WHOLE.has(c.fiat);
  return new Intl.NumberFormat(c.locale, {
    style: "currency",
    currency: c.fiat,
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: whole ? 0 : 2,
    ...(opts.compact ? { notation: "compact" as const } : {}),
  }).format(value);
}

/** A plain number in the currency's locale, no symbol, for inputs and rates. */
export function plain(value: number, c: Currency, digits?: number): string {
  const whole = WHOLE.has(c.fiat);
  return new Intl.NumberFormat(c.locale, { maximumFractionDigits: digits ?? (whole ? 0 : 2) }).format(value);
}

/** "1 wARS = 0,00323 wBRL", with enough digits that small rates still read. */
export function rateLine(rate: number, from: Currency, to: Currency): string {
  const digits = rate >= 100 ? 0 : rate >= 1 ? 2 : rate >= 0.01 ? 4 : 6;
  return `1 ${from.label} = ${new Intl.NumberFormat(to.locale, { maximumFractionDigits: digits }).format(rate)} ${to.label}`;
}

export function percent(delta: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" }).format(delta);
}

export function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function timeAgo(ms: number, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"], [60, "minute"], [24, "hour"], [7, "day"], [4.35, "week"], [12, "month"],
  ];
  let v = Math.round((ms - Date.now()) / 1000);
  for (const [size, unit] of steps) {
    if (Math.abs(v) < size) return rtf.format(v, unit);
    v = Math.round(v / size);
  }
  return rtf.format(v, "year");
}

export function usd(value: string | number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value));
}
