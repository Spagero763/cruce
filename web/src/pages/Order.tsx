import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Crossing } from "../components/Crossing";
import { Loading } from "../components/Loading";
import { Magnetic, Arrow } from "../components/Magnetic";
import { Rail, type Stop } from "../components/Rail";
import { api, payUrlFor, type AppConfig, type Order as OrderT } from "../lib/api";
import { money, shortAddress } from "../lib/format";
import { useI18n, type Key } from "../lib/i18n";
import { gsap, prefersReducedMotion, useGSAP } from "../lib/motion";
import { useWallet } from "../lib/wallet";
import { NotFound } from "./NotFound";
import "./app.css";

const RUNNING = new Set(["paid", "swapping", "paying_out"]);
const PROBLEM = new Set(["refunding", "refunded", "attention"]);

export function Order() {
  const { id = "" } = useParams();
  const { t, locale } = useI18n();
  const wallet = useWallet();
  const navigate = useNavigate();
  const [state, setState] = useState<{ order: OrderT; payUntil: number | null; config: AppConfig } | null>(null);
  const [missing, setMissing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [left, setLeft] = useState(0);
  const [nudged, setNudged] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const [{ order, payUntil }, config] = await Promise.all([api.order(id), api.config()]);
    setState({ order, payUntil, config });
    return order;
  }, [id]);

  useEffect(() => {
    load().catch(() => setMissing(true));
  }, [load]);

  const order = state?.order;
  const running = order ? RUNNING.has(order.status) : false;

  // While the agent works, the page follows along. A stalled order gets a nudge.
  useEffect(() => {
    if (!order || !running) return;
    const timer = setInterval(() => {
      void load().then((o) => {
        if (RUNNING.has(o.status) && Date.now() - o.updatedAt > 30_000 && Date.now() - nudged > 30_000) {
          setNudged(Date.now());
          void api.resume(o.id).catch(() => {});
        }
      }).catch(() => {});
    }, 2_500);
    return () => clearInterval(timer);
  }, [order?.id, running, load, nudged, order]);

  useEffect(() => {
    if (!state?.payUntil || state.order.status !== "awaiting_payment") return;
    const tick = () => setLeft(Math.max(0, Math.ceil((state.payUntil! - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [state?.payUntil, state?.order.status]);

  useGSAP(
    () => {
      if (!state || prefersReducedMotion()) return;
      gsap.fromTo(".o-reveal", { y: 26, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.9, ease: "hold", stagger: 0.07 });
    },
    { scope: root, dependencies: [!!state] },
  );

  if (missing) return <NotFound />;
  if (!state || !order) return <Loading />;
  const { config } = state;
  const cur = (code: string) => config.currencies.find((c) => c.code === code)!;
  const f = cur(order.from);
  const tc = cur(order.to);
  const expired = order.status === "awaiting_payment" && left === 0 && state.payUntil !== null;

  async function pay() {
    if (!order) return;
    setError(null);
    setPaying(true);
    try {
      const clients = await wallet.clients();
      const { payOrder } = await import("../lib/pay");
      const res = await payOrder({ payUrl: payUrlFor(order.id), order, config, ...clients });
      if (res.order) setState((s) => (s ? { ...s, order: res.order! } : s));
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (!/reject|denied|cancelled/i.test(msg)) setError(msg === "no-wallet" ? t("order.noWallet") : msg || t("error.generic"));
      await load().catch(() => {});
    } finally {
      setPaying(false);
    }
  }

  // The price moved on: the same conversion is priced again and a new order replaces this one.
  async function refresh() {
    if (!order) return;
    setRefreshing(true);
    setError(null);
    try {
      const { quote } = await api.quote(order.from, order.to, order.display.in, order.partner);
      const { order: next } = await api.createOrder(quote.id, order.recipient ?? undefined);
      navigate(`/o/${next.id}`, { replace: true });
      setState(null);
      setMissing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error.generic"));
    } finally {
      setRefreshing(false);
    }
  }

  const share = () => {
    void navigator.clipboard?.writeText(location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  const legsDone = order.legs.filter((l) => l.out).length;
  const stage: 0 | 1 | 2 = order.status === "done" || order.payoutTx ? 2 : legsDone > 0 || order.status === "swapping" ? 1 : 0;
  const counterparties = new Set(order.legs.flatMap((l) => l.counterparties)).size;
  const statusKind = order.status === "done" ? "done" : PROBLEM.has(order.status) ? "problem" : running ? "running" : "waiting";

  const stops: Stop[] = [];
  if (order.status !== "awaiting_payment" || paying) {
    stops.push({ label: t("order.rail.pay"), tx: order.paidTx, state: order.paidTx ? "done" : "active" });
    let activeSet = false;
    for (const leg of order.legs) {
      const done = Boolean(leg.out);
      const active = !done && !activeSet && order.status === "swapping";
      if (active) activeSet = true;
      stops.push({
        label: t("order.rail.leg", { from: cur(leg.from).label, to: cur(leg.to).label }),
        tx: leg.tx,
        state: done ? "done" : active ? "active" : "pending",
        sub: done && leg.out ? `${t(`venue.${leg.venue}` as Key)} · ${money(leg.out, cur(leg.to))}` : null,
      });
    }
    if (PROBLEM.has(order.status)) {
      stops.push({ label: t("order.rail.refund"), tx: order.refundTx, state: order.status === "refunded" ? "done" : order.status === "attention" ? "problem" : "active" });
    } else {
      stops.push({ label: t("order.rail.payout"), tx: order.payoutTx, state: order.payoutTx ? "done" : order.status === "paying_out" ? "active" : "pending" });
    }
  }

  return (
    <div ref={root} className="page wrap order">
      <div className="order-visual">
        <Crossing from={order.from} to={order.to} size="md" stage={stage} />
        <div className="order-big o-reveal">
          <p className="eyebrow">{order.status === "done" ? t("order.done.title") : t("cv.get.me")}</p>
          <span className="display">{money(order.out ?? order.estOut, tc)}</span>
          {order.recipient && <span className="note mono">{t("order.done.to", { to: shortAddress(order.recipient) })}</span>}
        </div>
      </div>

      <div className="card order-side">
        <span className={`order-status order-status--${statusKind} o-reveal`}>
          <span className="dot" /> {t(`order.status.${order.status}` as Key)}
        </span>

        {order.status === "awaiting_payment" && (
          <>
            <h1 className="display page-title o-reveal">{t("order.review")}</h1>
            <div className="order-lines o-reveal">
              <div className="order-line">
                <span>{t("cv.change")}</span>
                <span className="display">{money(order.amountIn, f)}</span>
              </div>
              <div className="order-line">
                <span>{t("cv.get.me")}</span>
                <span className="display">{money(order.estOut, tc)}</span>
              </div>
              <div className="order-line">
                <span>{t("cv.min", { min: "" }).trim()}</span>
                <span className="mono">{money(order.minOut, tc)}</span>
              </div>
              {order.recipient && (
                <div className="order-line">
                  <span>{t("order.to")}</span>
                  <span className="mono">{shortAddress(order.recipient)}</span>
                </div>
              )}
            </div>
            {expired ? (
              <div className="order-expired o-reveal">
                <p className="note">{t("order.expired")}</p>
                <Magnetic onClick={() => void refresh()} disabled={refreshing}>
                  {t("order.refresh")} <Arrow />
                </Magnetic>
              </div>
            ) : (
              <div className="order-action o-reveal">
                <Magnetic onClick={() => void (wallet.address ? pay() : wallet.connect().then(() => pay()).catch(() => {}))} disabled={paying || !wallet.canConnect}>
                  {paying ? t("order.paying") : wallet.address || wallet.isMiniPay ? t("order.pay", { amount: money(order.amountIn, f) }) : t("cv.connect")}
                </Magnetic>
                <p className="order-fine mono">
                  {wallet.canConnect ? t("order.gasless") : t("order.noWallet")} · {left}s
                </p>
                <p className="order-fine">{t("order.guaranteed", { min: money(order.minOut, tc) })}</p>
              </div>
            )}
            {error && <p className="form-error">{error}</p>}
          </>
        )}

        {order.status === "done" && (
          <div className="order-done o-reveal">
            <p className="eyebrow">{t("order.done.title")}</p>
            <span className="display">{money(order.out ?? order.estOut, tc)}</span>
            <p className="note">
              {order.recipient && t("order.done.to", { to: shortAddress(order.recipient) })}
              {counterparties > 0 && ` · ${t("order.done.makers", { n: counterparties })}`}
            </p>
          </div>
        )}

        {order.status === "refunded" && <p className="order-note order-note--ok o-reveal">{order.legs.some((l) => l.out) ? t("order.refunded.dollars") : t("order.refunded.note")}</p>}
        {order.status === "attention" && <p className="order-note order-note--problem o-reveal">{t("order.attention.note")}</p>}
        {running && Date.now() - order.updatedAt > 30_000 && <p className="order-note o-reveal">{t("order.nudge")}</p>}

        {stops.length > 0 && (
          <div className="o-reveal">
            <Rail stops={stops} explorer={config.explorer} viewLabel={t("order.view")} />
          </div>
        )}

        {(order.status === "done" || PROBLEM.has(order.status)) && (
          <div className="row o-reveal">
            <Magnetic to="/" variant="ink">
              {t("order.again")} <Arrow />
            </Magnetic>
            <Magnetic variant="ghost" onClick={share}>
              {copied ? t("order.copied") : t("order.share")}
            </Magnetic>
          </div>
        )}
        <p className="note mono" style={{ fontSize: "0.72rem" }}>
          {new Date(order.createdAt).toLocaleString(locale)}
        </p>
      </div>
    </div>
  );
}
