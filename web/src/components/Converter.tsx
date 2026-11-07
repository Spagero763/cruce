import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { erc20Abi, formatUnits } from "viem";
import { api, ApiError, type AppConfig, type Compare, type Currency, type Quote } from "../lib/api";
import { explain } from "../lib/explain";
import { money, percent, rateLine } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { useWallet } from "../lib/wallet";
import { CurrencyMark } from "./CurrencyMark";
import { Magnetic, Arrow } from "./Magnetic";
import { Rolling } from "./Rolling";
import { useTransitionNavigate } from "./Transition";
import "./Converter.css";

const DEFAULT_AMOUNT: Record<string, string> = { IDRX: "300000", wARS: "50000", wBRL: "250", wCOP: "150000", cNGN: "50000", wMXN: "800", wCLP: "40000", wPEN: "150", USDT: "50", USDC: "50", USAT: "50" };

export interface ConverterStart {
  from?: string;
  to?: string;
  amount?: string;
  partner?: string | null;
}

/** The product: an amount, two currencies, a live price, one button. */
export function Converter({ config, start = {}, className = "", onQuote }: { config: AppConfig; start?: ConverterStart; className?: string; onQuote?: (q: Quote | null) => void }) {
  const { t, locale } = useI18n();
  const wallet = useWallet();
  const go = useTransitionNavigate();
  const codes = config.currencies.filter((c) => c.enabled).map((c) => c.code);
  const [from, setFrom] = useState(codes.includes(start.from ?? "") ? start.from! : "wARS");
  const [to, setTo] = useState(codes.includes(start.to ?? "") && start.to !== from ? start.to! : from === "wBRL" ? "wARS" : "wBRL");
  const [amount, setAmount] = useState(start.amount ?? DEFAULT_AMOUNT[from] ?? "50");
  const [quote, setQuote] = useState<{ quote: Quote; compare: Compare | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [other, setOther] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);

  // What the connected wallet holds of the currency being changed, for the 25/50/75/Max buttons.
  useEffect(() => {
    if (!wallet.address) {
      setBalance(null);
      return;
    }
    let live = true;
    const token = config.currencies.find((c) => c.code === from)!.address;
    void wallet
      .clients()
      .then(({ pub, address }) => pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [address] }))
      .then((b) => live && setBalance(b))
      .catch(() => live && setBalance(null));
    return () => {
      live = false;
    };
  }, [wallet, wallet.address, from, config.currencies]);

  const cur = (code: string) => config.currencies.find((c) => c.code === code)!;
  const f = cur(from);
  const tc = cur(to);

  const fetchQuote = useCallback(async () => {
    abort.current?.abort();
    if (!amount || Number(amount) === 0) {
      setQuote(null);
      setError(null);
      onQuote?.(null);
      return;
    }
    const ac = new AbortController();
    abort.current = ac;
    setLoading(true);
    try {
      const q = await api.quote(from, to, amount, start.partner ?? null, ac.signal);
      if (ac.signal.aborted) return;
      setQuote(q);
      onQuote?.(q.quote);
      setError(null);
    } catch (e) {
      if (ac.signal.aborted) return;
      setQuote(null);
      onQuote?.(null);
      setError(explain(e, t));
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [amount, from, to, start.partner, t, onQuote]);

  useEffect(() => {
    const timer = setTimeout(() => void fetchQuote(), 320);
    return () => clearTimeout(timer);
  }, [fetchQuote]);

  // The price holds for a short while; while the page is open it is refreshed as it runs out.
  useEffect(() => {
    if (!quote) return;
    const tick = () => {
      const s = Math.max(0, Math.ceil((quote.quote.expiresAt - Date.now()) / 1000));
      setLeft(s);
      if (s === 0 && document.visibilityState === "visible" && !busy) void fetchQuote();
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [quote, fetchQuote, busy]);

  const pick = (side: "from" | "to", code: string) => {
    if (side === "from") {
      if (code === to) setTo(from);
      setFrom(code);
      if (amount === (DEFAULT_AMOUNT[from] ?? "")) setAmount(DEFAULT_AMOUNT[code] ?? "50");
    } else {
      if (code === from) setFrom(to);
      setTo(code);
    }
  };

  const flip = () => {
    const nextAmount = quote ? trimmed(quote.quote.display.out, tc) : (DEFAULT_AMOUNT[to] ?? "50");
    setFrom(to);
    setTo(from);
    setAmount(nextAmount);
  };

  const recipientOk = !other || /^0x[0-9a-fA-F]{40}$/.test(recipient);
  const ready = Boolean(quote) && recipientOk && !loading && !busy;

  const submit = async () => {
    if (!quote) return;
    setBusy(true);
    setError(null);
    try {
      if (!wallet.address) await wallet.connect();
      let q = quote.quote;
      if (Date.now() > q.expiresAt - 3_000) q = (await api.quote(from, to, amount, start.partner ?? null)).quote;
      const { order } = await api.createOrder(q.id, other ? recipient : undefined);
      go(`/o/${order.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 410) void fetchQuote();
      setError(explain(e, t));
    } finally {
      setBusy(false);
    }
  };

  const rate = useMemo(() => (quote ? Number(quote.quote.display.out) / Number(quote.quote.display.in) : null), [quote]);
  const compare = quote?.compare ?? null;
  const ourOut = quote ? Number(quote.quote.display.out) : 0;
  const shown = quote ? money(quote.quote.estOut, tc) : money(0n, tc);

  return (
    <div className={`cv card ${className}`}>
      <div className="cv-side">
        <div className="cv-head">
          <span className="eyebrow">{t("cv.change")}</span>
          {balance !== null && (
            <span className="cv-balance mono">
              {t("cv.balance", { amount: money(balance, f) })}
            </span>
          )}
        </div>
        <input
          className="cv-amount display"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(",", ".").replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"))}
          placeholder="0"
          aria-label={t("cv.change")}
        />
        {balance !== null && balance > 0n && (
          <div className="cv-parts" role="group" aria-label={t("cv.balance", { amount: "" })}>
            {[25, 50, 75, 100].map((p) => (
              <button key={p} type="button" className="cv-part mono" onClick={() => setAmount(share(balance, p, f))}>
                {p === 100 ? t("cv.max") : `${p}%`}
              </button>
            ))}
          </div>
        )}
        <FlagRail code={from} currencies={config.currencies} onPick={(c) => pick("from", c)} soon={t("cv.soon")} />
        {(f.payIn === false || f.permit === false) && !wallet.isMiniPay && <p className="cv-fee mono">{t("fee.celo.short")}</p>}
      </div>

      <div className="cv-mid">
        <button type="button" className="cv-flip" onClick={flip} aria-label="Swap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3" />
          </svg>
        </button>
      </div>

      <div className="cv-side cv-side--out">
        <span className="eyebrow">{other ? t("cv.get") : t("cv.get.me")}</span>
        <output className={`cv-amount display ${loading ? "is-loading" : ""} ${!quote ? "is-empty" : ""}`}>
          <Rolling value={shown} />
        </output>
        <FlagRail code={to} currencies={config.currencies} onPick={(c) => pick("to", c)} soon={t("cv.soon")} />
        <p className="cv-meta mono">
          {quote && rate ? (
            <>
              {rateLine(rate, f, tc)} · {t("cv.fee", { fee: `${config.limits.feeBps / 100}%` })} · {t("cv.min", { min: money(quote.quote.minOut, tc) })}
            </>
          ) : error ? (
            <span className="cv-error">{error}</span>
          ) : (
            t("cv.amount")
          )}
        </p>
      </div>

      {compare && (compare.official || compare.street) && quote && (
        <ul className="cv-compare">
          {compare.official && <Row label={t("cv.official")} out={compare.official.out} ours={ourOut} c={tc} locale={locale} />}
          {compare.street && <Row label={t("cv.street")} out={compare.street.out} ours={ourOut} c={tc} locale={locale} />}
        </ul>
      )}

      <div className="cv-recipient">
        <div className="chips" role="radiogroup">
          <button type="button" role="radio" aria-checked={!other} className={`chip ${!other ? "is-on" : ""}`} onClick={() => setOther(false)}>
            {t("cv.me")}
          </button>
          <button type="button" role="radio" aria-checked={other} className={`chip ${other ? "is-on" : ""}`} onClick={() => setOther(true)}>
            {t("cv.someone")}
          </button>
        </div>
        {other && (
          <input className="cv-address mono" value={recipient} onChange={(e) => setRecipient(e.target.value.trim())} placeholder="0x…" aria-label={t("cv.address")} spellCheck={false} />
        )}
      </div>

      {error && quote && <p className="form-error">{error}</p>}

      <div className="cv-action">
        <Magnetic onClick={() => void submit()} disabled={!ready} className="cv-cta">
          {busy ? t("cv.pricing") : wallet.address || wallet.isMiniPay || !quote ? t("cv.cta", { from: f.label, to: tc.label }) : t("cv.connect")} <Arrow />
        </Magnetic>
        {quote && (
          <span className="cv-fresh mono" style={{ "--p": `${(left / config.limits.quoteSeconds) * 100}%` } as never}>
            {t("cv.fresh", { s: left })}
          </span>
        )}
      </div>
    </div>
  );
}

function Row({ label, out, ours, c, locale }: { label: string; out: number; ours: number; c: Currency; locale: string }) {
  const delta = out > 0 ? ours / out - 1 : 0;
  return (
    <li className="cv-cmp">
      <span>{label}</span>
      <span className="mono">{money(BigInt(Math.round(out * 10 ** c.decimals)), c)}</span>
      <span className={`cv-delta mono ${delta >= 0 ? "is-up" : "is-down"}`}>{percent(delta, locale)}</span>
    </li>
  );
}

/** A share of the balance as the input's decimal string, rounded down so it never exceeds what is held. */
function share(balance: bigint, percent: number, c: Currency): string {
  const part = (balance * BigInt(percent)) / 100n;
  const [whole, frac = ""] = formatUnits(part, c.decimals).split(".");
  const keep = ["ARS", "COP", "NGN", "CLP", "IDR"].includes(c.fiat) ? 0 : Math.min(6, c.decimals);
  return keep && frac ? `${whole}.${frac.slice(0, keep).replace(/0+$/, "")}`.replace(/\.$/, "") : whole;
}

function trimmed(decimal: string, c: Currency): string {
  const n = Number(decimal);
  const whole = ["ARS", "COP", "NGN", "CLP", "IDR"].includes(c.fiat);
  return whole ? String(Math.floor(n)) : n.toFixed(2);
}

/** The currencies as a rail of flags. The chosen one slides into focus; the ones to come are dimmed. */
function FlagRail({ code, currencies, onPick, soon }: { code: string; currencies: Currency[]; onPick: (code: string) => void; soon: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  // Only the rail scrolls, never the page, and not on first paint.
  useEffect(() => {
    const rail = ref.current;
    const on = rail?.querySelector<HTMLElement>(".flag.is-on");
    if (!rail || !on) return;
    const left = on.offsetLeft - rail.clientWidth / 2 + on.offsetWidth / 2;
    rail.scrollTo({ left, behavior: first.current ? "auto" : "smooth" });
    first.current = false;
  }, [code]);
  return (
    <div ref={ref} className="flags" role="radiogroup">
      {currencies.map((c) => (
        <button
          key={c.code}
          type="button"
          role="radio"
          aria-checked={c.code === code}
          className={`flag ${c.code === code ? "is-on" : ""}`}
          disabled={!c.enabled}
          title={c.enabled ? c.fiat : soon}
          onClick={() => onPick(c.code)}
        >
          <CurrencyMark code={c.code} />
          <span>{c.label}</span>
        </button>
      ))}
    </div>
  );
}
