// Which local currencies can actually be changed right now. The hand-vetted ones are always on;
// the rest switch themselves on while some venue quotes them both ways at a small size, and off
// again when that depth is gone. Open quotes are unaffected: they settle or refund on their own terms.
import { parseUnits } from "viem";
import { CURRENCIES, CURRENCY_CODES, type CurrencyCode } from "./currencies.js";
import { priceLeg, type Venues } from "./router.js";

const TTL_MS = 60_000;
const SAMPLE_USD = "5";

export type Availability = ReturnType<typeof createAvailability>;

export function createAvailability(venues: Venues, log = console) {
  let cache: { at: number; live: Partial<Record<CurrencyCode, boolean>> } | null = null;
  let pending: Promise<Partial<Record<CurrencyCode, boolean>>> | null = null;

  async function probe(): Promise<Partial<Record<CurrencyCode, boolean>>> {
    const live: Partial<Record<CurrencyCode, boolean>> = {};
    const sample = parseUnits(SAMPLE_USD, CURRENCIES.USDT.decimals);
    await Promise.all(
      CURRENCY_CODES.filter((c) => !CURRENCIES[c].enabled).map(async (c) => {
        try {
          const out = await priceLeg(venues, "USDT", c, sample);
          if (!out) return;
          const back = await priceLeg(venues, c, "USDT", out.out);
          live[c] = Boolean(back);
        } catch (err) {
          log.warn("[availability]", c, String(err).slice(0, 120));
        }
      }),
    );
    return live;
  }

  async function live(): Promise<Partial<Record<CurrencyCode, boolean>>> {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.live;
    pending ??= probe()
      .then((l) => {
        cache = { at: Date.now(), live: l };
        return l;
      })
      .finally(() => {
        pending = null;
      });
    return cache?.live ?? pending;
  }

  return {
    live,
    async enabled(code: CurrencyCode): Promise<boolean> {
      if (CURRENCIES[code].enabled) return true;
      return (await live())[code] === true;
    },
    /** The currency table as the public sees it, with what is live right now folded in. */
    async currencies() {
      const l = await live();
      return CURRENCY_CODES.map((code) => ({ ...CURRENCIES[code], enabled: CURRENCIES[code].enabled || l[code] === true }));
    },
  };
}
