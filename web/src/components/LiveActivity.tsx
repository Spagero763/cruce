import { useEffect, useState } from "react";
import { api, type Activity, type AppConfig } from "../lib/api";
import { money, timeAgo, usd } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { CurrencyMark } from "./CurrencyMark";
import "./LiveActivity.css";

/** What has moved through the agent, straight from the orders table, each with its chain receipt. */
export function LiveActivity() {
  const { t, locale } = useI18n();
  const [data, setData] = useState<{ a: Activity; config: AppConfig } | null>(null);

  useEffect(() => {
    let on = true;
    const load = () => Promise.all([api.activity(), api.config()]).then(([a, config]) => on && setData({ a, config })).catch(() => {});
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      on = false;
      clearInterval(timer);
    };
  }, []);

  if (!data || data.a.done === 0) return null;
  const { a, config } = data;
  const cur = (code: string) => config.currencies.find((c) => c.code === code);

  return (
    <section className="live wrap">
      <p className="eyebrow">
        <span className="live-dot" aria-hidden /> {t("live.eyebrow")}
      </p>
      <div className="live-grid">
        <div className="live-stat">
          <span className="display live-n">{a.done}</span>
          <span className="live-l">{t("live.done")}</span>
        </div>
        <div className="live-stat">
          <span className="display live-n">{a.wallets}</span>
          <span className="live-l">{t("live.wallets")}</span>
        </div>
        <div className="live-stat">
          <span className="display live-n">{usd(a.usd, locale)}</span>
          <span className="live-l">{t("live.usd")}</span>
        </div>
        <div className="live-stat live-corridors">
          <span className="live-pairs">
            {a.corridors.slice(0, 4).map((c) => (
              <span key={`${c.from}${c.to}`} className="live-pair mono">
                <CurrencyMark code={c.from} />
                <CurrencyMark code={c.to} />
                {c.count}
              </span>
            ))}
          </span>
          <span className="live-l">{t("live.corridors")}</span>
        </div>
      </div>
      <ul className="live-list">
        {a.recent.map((r) => {
          const f = cur(r.from);
          const to = cur(r.to);
          if (!f || !to) return null;
          return (
            <li key={r.id} className="live-row">
              <span className="live-amt">
                <CurrencyMark code={r.from} /> {money(r.amountIn, f)}
              </span>
              <span className="live-arrow" aria-hidden>
                →
              </span>
              <span className="live-amt">
                <CurrencyMark code={r.to} /> {r.out ? money(r.out, to) : "…"}
              </span>
              <span className="live-when mono">{timeAgo(r.at, locale)}</span>
              {r.tx && (
                <a className="live-tx mono" href={`${config.explorer}/tx/${r.tx}`} target="_blank" rel="noreferrer">
                  {t("order.view")} ↗
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
