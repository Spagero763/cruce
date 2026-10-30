// Reference rates: what a unit of each currency is worth against the dollar off-chain. Two
// layers: the official rate from public feeds, and the street rate (blue, parallel, cripto) that
// people in Argentina and Nigeria actually transact at, read from the boards through buy.
import type { Buy } from "./buy.js";
import type { Store } from "./db.js";

export interface FiatRef {
  official: number | null;
  street: number | null;
  at: number;
}

export interface Reference {
  /** Units of each currency per dollar, using the street rate where there is one. */
  perUsd: Record<string, number>;
  fiats: Record<string, FiatRef>;
  at: number;
}

const OFFICIAL_TTL = 10 * 60_000;
const STREET_TTL = 60 * 60_000;
const FIATS = ["ARS", "BRL", "COP", "MXN", "CLP", "PEN", "NGN"];

/** Boards read through a rented browser. Each is a public page with one headline rate. */
const BOARDS: { fiat: string; url: string; ask: string }[] = [
  { fiat: "ARS", url: "https://dolarhoy.com/cotizaciondolarblue", ask: "the dólar blue selling price (venta) in pesos per dollar" },
  { fiat: "BRL", url: "https://dolarhoje.com/dolar-turismo/", ask: "the dólar turismo price in reais per dollar (the sentence 'A cotação do dolar turismo hoje é R$ …')" },
];

export const EXTRACT_PROMPT =
  "You read a currency exchange page and answer with one number only. If the page has several values, pick the one asked for. If you cannot find it, answer 0.";

export function parseNumber(text: string): number | null {
  const m = text.replace(/\s/g, "").match(/\d[\d.,]*/);
  if (!m) return null;
  let s = m[0];
  // 1.650,50 and 1,650.50 both read as 1650.5; 1650 stays 1650.
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function createRates(store: Store, buy: Buy, fetchFn: typeof fetch = fetch, log = console) {
  async function official(): Promise<Record<string, number>> {
    const cached = await store.getRate<Record<string, number>>("official");
    if (cached && Date.now() - cached.at < OFFICIAL_TTL) return cached.value;
    try {
      const res = await fetchFn("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(8_000) });
      const body = (await res.json()) as { rates?: Record<string, number> };
      const rates = Object.fromEntries(FIATS.filter((f) => body.rates?.[f]).map((f) => [f, body.rates![f]]));
      // Argentina publishes its own ladder; the official there is the bank rate, the cripto rate is what wARS trades at.
      const ar = await fetchFn("https://dolarapi.com/v1/dolares", { signal: AbortSignal.timeout(8_000) }).then((r) => r.json()).catch(() => null);
      if (Array.isArray(ar)) {
        const pick = (casa: string) => (ar as { casa: string; venta: number }[]).find((d) => d.casa === casa)?.venta;
        const oficial = pick("oficial");
        if (oficial) rates.ARS = oficial;
        const street: Record<string, number> = {};
        const blue = pick("blue");
        const cripto = pick("cripto");
        if (cripto) street.ARS = cripto;
        else if (blue) street.ARS = blue;
        if (Object.keys(street).length) await store.setRate("street:ARS", { value: street.ARS, source: "dolarapi" });
      }
      // Brazil publishes the tourist dollar, the rate a person pays at a casa de câmbio, as a feed.
      const br = await fetchFn("https://economia.awesomeapi.com.br/json/last/USD-BRLT", { signal: AbortSignal.timeout(8_000) }).then((r) => r.json()).catch(() => null);
      const turismo = Number((br as { USDBRLT?: { ask?: string } } | null)?.USDBRLT?.ask);
      if (turismo > 0 && !(await store.getRate(`street:BRL`))) await store.setRate("street:BRL", { value: turismo, source: "awesomeapi" });
      if (Object.keys(rates).length) await store.setRate("official", rates);
      return rates;
    } catch (err) {
      log.error("[rates] official", err);
      return cached?.value ?? {};
    }
  }

  async function street(): Promise<Record<string, { value: number; at: number }>> {
    const out: Record<string, { value: number; at: number }> = {};
    for (const f of FIATS) {
      const r = await store.getRate<{ value: number }>(`street:${f}`);
      if (r && Date.now() - r.at < STREET_TTL * 6) out[f] = { value: r.value.value, at: r.at };
    }
    return out;
  }

  return {
    /** Street rate where known, official otherwise. Never throws; an empty reference just disables the drift check. */
    async reference(): Promise<Reference> {
      const [off, st] = await Promise.all([official(), street()]);
      const fiats: Record<string, FiatRef> = {};
      const perUsd: Record<string, number> = { USD: 1 };
      for (const f of FIATS) {
        const o = off[f] ?? null;
        const s = st[f]?.value ?? null;
        if (o === null && s === null) continue;
        fiats[f] = { official: o, street: s, at: st[f]?.at ?? Date.now() };
        perUsd[f] = s ?? o!;
      }
      return { perUsd, fiats, at: Date.now() };
    },

    /** Reads the boards the agent doesn't control. Paid per rental, so once an hour is plenty. */
    async refreshStreet(): Promise<number> {
      const due = [];
      for (const b of BOARDS) {
        const r = await store.getRate<{ source?: string }>(`street:${b.fiat}`);
        if (!r || Date.now() - r.at > STREET_TTL) due.push(b);
      }
      if (!due.length) return 0;
      const browser = await buy.rentBrowser(3);
      let read = 0;
      try {
        await browser.ready();
        for (const b of due) {
          try {
            await browser.open(b.url);
            await browser.command({ action: "wait", milliseconds: 2_500 });
            const text = (await browser.text()).slice(0, 5_000);
            const answer = await buy.complete(EXTRACT_PROMPT, `Question: ${b.ask}\n\nPage:\n${text}`);
            const value = parseNumber(answer);
            if (value) {
              await store.setRate(`street:${b.fiat}`, { value, source: new URL(b.url).hostname });
              read++;
            }
          } catch (err) {
            log.error("[rates] board", b.fiat, String(err).slice(0, 200));
          }
        }
      } finally {
        await browser.close();
      }
      return read;
    },
  };
}

export type Rates = ReturnType<typeof createRates>;
