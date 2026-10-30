import { useCallback, useEffect, useRef, useState } from "react";
import { CurrencyMark } from "../components/CurrencyMark";
import { Magnetic, Arrow } from "../components/Magnetic";
import { TLink } from "../components/Transition";
import { WalletCard } from "../components/WalletCard";
import { api, type AppConfig, type Order } from "../lib/api";
import { money, timeAgo } from "../lib/format";
import { useI18n, type Key } from "../lib/i18n";
import { gsap, prefersReducedMotion, useGSAP } from "../lib/motion";
import { useWallet } from "../lib/wallet";
import "./app.css";

export function Me() {
  const { t, locale } = useI18n();
  const wallet = useWallet();
  const [state, setState] = useState<{ config: AppConfig; orders: Order[] } | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!wallet.address) return;
    const [config, { orders }] = await Promise.all([api.config(), api.myOrders(wallet.address)]);
    setState({ config, orders });
  }, [wallet.address]);

  useEffect(() => {
    void load();
  }, [load]);

  useGSAP(
    () => {
      if (!state || prefersReducedMotion()) return;
      gsap.fromTo(".me-reveal", { y: 26, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.9, ease: "hold", stagger: 0.07 });
    },
    { scope: root, dependencies: [!!state] },
  );

  if (!wallet.address) {
    return (
      <div className="page wrap not-found">
        <p className="lead">{t("me.connect")}</p>
        <Magnetic onClick={() => void wallet.connect().catch(() => {})} disabled={!wallet.canConnect}>
          {t("nav.connect")}
        </Magnetic>
      </div>
    );
  }

  return (
    <div ref={root} className="page wrap me">
      <div className="me-head me-reveal">
        <h1 className="display page-title">{t("me.title")}</h1>
        <Magnetic to="/">
          {t("me.new")} <Arrow />
        </Magnetic>
      </div>

      {state && (
        <div className="me-grid">
          <div className="me-col">
            <WalletCard config={state.config} />
          </div>
          <div className="card me-reveal">
            <p className="eyebrow">{t("me.orders")}</p>
            {state.orders.length === 0 ? (
              <p className="note" style={{ marginTop: 12 }}>
                {t("me.empty")}
              </p>
            ) : (
              <ul className="orders">
                {state.orders.map((o) => {
                  const f = state.config.currencies.find((c) => c.code === o.from)!;
                  const tc = state.config.currencies.find((c) => c.code === o.to)!;
                  return (
                    <li key={o.id} className="order-row">
                      <TLink to={`/o/${o.id}`}>
                        <span className={`me-dot me-dot--${o.status}`} />
                        <span>
                          <span className="amounts">
                            <CurrencyMark code={o.from} /> {money(o.amountIn, f)} <span style={{ color: "var(--cross)" }}>→</span> <CurrencyMark code={o.to} /> {money(o.out ?? o.estOut, tc)}
                          </span>
                          <br />
                          <span className="note" style={{ fontSize: "0.8rem" }}>
                            {t(`order.status.${o.status}` as Key)} · {timeAgo(o.updatedAt, locale)}
                          </span>
                        </span>
                        <span aria-hidden>→</span>
                      </TLink>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
