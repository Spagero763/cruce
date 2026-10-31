import { useCallback, useEffect, useRef, useState } from "react";
import { Magnetic } from "../components/Magnetic";
import { api, type AppConfig, type Partner } from "../lib/api";
import { usd } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { gsap, prefersReducedMotion, useGSAP } from "../lib/motion";
import { useWallet } from "../lib/wallet";
import "./app.css";

const SAMPLE = `import { Cruce } from "@cruce/sdk";

const cruce = new Cruce({ partner: "your-code" });

// 1. price it: estimate, guaranteed minimum, fee, route
const q = await cruce.quote({ from: "wARS", to: "wBRL", amount: "50000" });

// 2. pay it with any viem wallet client; one signature, no gas
const order = await cruce.pay(q, { wallet, recipient: "0x…" });

// 3. follow it: each leg lands with its own transaction
const final = await cruce.wait(order.id);

// or pay any x402 service in what you hold; Cruce converts and pays the seller
const { body } = await cruce.payEndpoint({ url: "https://…", from: "cNGN", wallet });`;

export function Developers() {
  const { t, locale } = useI18n();
  const wallet = useWallet();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [partners, setPartners] = useState<(Partner & { stats?: { done: number; usd: string } })[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [link, setLink] = useState({ from: "wARS", to: "wBRL", amount: "50000" });
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api.config().then(setConfig).catch(() => {});
  }, []);

  const loadPartners = useCallback(async () => {
    if (!wallet.address) return setPartners([]);
    const { partners } = await api.partnersOf(wallet.address);
    const withStats = await Promise.all(partners.map(async (p) => ({ ...p, stats: (await api.partner(p.code).catch(() => null))?.stats })));
    setPartners(withStats);
  }, [wallet.address]);

  useEffect(() => {
    void loadPartners();
  }, [loadPartners]);

  useGSAP(
    () => {
      if (!config || prefersReducedMotion()) return;
      gsap.fromTo(".d-reveal", { y: 26, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.9, ease: "hold", stagger: 0.07 });
    },
    { scope: root, dependencies: [!!config] },
  );

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await api.createPartner(name.trim(), await wallet.signIn("partner"));
      setName("");
      await loadPartners();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (!/reject|denied|cancelled/i.test(msg)) setError(msg || t("error.generic"));
    } finally {
      setBusy(false);
    }
  }

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(text);
      setTimeout(() => setCopied(null), 1600);
    });
  };

  const code = partners[0]?.code ?? "your-code";
  const url = `${location.origin}/?${new URLSearchParams({ from: link.from, to: link.to, amount: link.amount, ref: code })}`;
  const enabled = config?.currencies.filter((c) => c.enabled) ?? [];

  return (
    <div ref={root} className="page wrap">
      <h1 className="display page-title d-reveal">{t("devp.title")}</h1>
      <p className="lead d-reveal">{t("devp.body")}</p>

      <div className="devp-grid">
        <div className="devp-col">
          <div className="card d-reveal">
            <p className="eyebrow">{t("devp.install")}</p>
            <pre className="code" style={{ marginTop: 12 }}>
              npm install @cruce/sdk viem
            </pre>
            <p className="eyebrow" style={{ marginTop: 22 }}>
              {t("devp.quote")}
            </p>
            <pre className="code" style={{ marginTop: 12 }}>
              {SAMPLE}
            </pre>
          </div>

          <div className="card d-reveal">
            <p className="eyebrow">{t("devp.api")}</p>
            <p className="note" style={{ marginTop: 8 }}>
              {t("devp.api.body")}
            </p>
            <ul className="api-list">
              <li>
                <span className="mono">GET</span>
                <span>
                  <span className="mono">/api/quote?from=wARS&to=wBRL&amount=50000&partner=code</span>
                  <em>estimate, minimum, fee, route, 45 s hold</em>
                </span>
              </li>
              <li>
                <span className="mono">POST</span>
                <span>
                  <span className="mono">/api/orders {"{ quoteId, recipient? }"}</span>
                  <em>an order to pay, and its x402 pay URL</em>
                </span>
              </li>
              <li>
                <span className="mono">POST</span>
                <span>
                  <span className="mono">/x402/orders/:id/pay</span>
                  <em>402 with the exact amount in the input token; settle it with any x402 client</em>
                </span>
              </li>
              <li>
                <span className="mono">GET</span>
                <span>
                  <span className="mono">/api/orders/:id</span>
                  <em>status, legs with transactions, payout, refund</em>
                </span>
              </li>
              <li>
                <span className="mono">POST</span>
                <span>
                  <span className="mono">/api/pay/quote {"{ url, from }"}</span>
                  <em>pay any x402 service in the currency you hold: Cruce converts, pays the seller, returns the answer and the change</em>
                </span>
              </li>
              <li>
                <span className="mono">GET</span>
                <span>
                  <span className="mono">/api/rates</span>
                  <em>official and street reference rates the agent checks itself against</em>
                </span>
              </li>
            </ul>
          </div>
        </div>

        <div className="devp-col">
          <div className="card d-reveal">
            <p className="eyebrow">{t("devp.partner.title")}</p>
            <p className="note" style={{ margin: "8px 0 16px" }}>
              {t("devp.partner.body")}
            </p>
            {partners.map((p) => (
              <div key={p.code} className="partner-row">
                <button className="partner-code mono" onClick={() => copy(p.code)}>
                  {p.code} <span>{copied === p.code ? "✓" : "⧉"}</span>
                </button>
                <span className="note">{p.stats ? t("devp.stats", { n: p.stats.done, usd: usd(p.stats.usd, locale) }) : p.name}</span>
              </div>
            ))}
            {wallet.address ? (
              <form
                style={{ marginTop: 16, display: "grid", gap: 10 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (name.trim().length >= 2 && !busy) void create();
                }}
              >
                <label className="field" style={{ marginBottom: 0 }}>
                  <span>{t("devp.partner.name")}</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mi tienda" maxLength={40} />
                </label>
                <Magnetic type="submit" disabled={busy || name.trim().length < 2}>
                  {busy ? t("devp.partner.signing") : t("devp.partner.create")}
                </Magnetic>
                {error && <p className="form-error">{error}</p>}
              </form>
            ) : (
              <Magnetic onClick={() => void wallet.connect().catch(() => {})} disabled={!wallet.canConnect}>
                {t("devp.partner.connect")}
              </Magnetic>
            )}
          </div>

          <div className="card d-reveal">
            <p className="eyebrow">{t("devp.link.title")}</p>
            <p className="note" style={{ margin: "8px 0 16px" }}>
              {t("devp.link.body")}
            </p>
            <div className="row" style={{ marginBottom: 14 }}>
              <select className="chip" value={link.from} onChange={(e) => setLink({ ...link, from: e.target.value })}>
                {enabled.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
              <select className="chip" value={link.to} onChange={(e) => setLink({ ...link, to: e.target.value })}>
                {enabled.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
              <input className="chip" style={{ width: 120 }} inputMode="decimal" value={link.amount} onChange={(e) => setLink({ ...link, amount: e.target.value.replace(/[^\d.]/g, "") })} />
            </div>
            <button className="link-box mono" style={{ width: "100%", textAlign: "left", cursor: "pointer" }} onClick={() => copy(url)}>
              {url} {copied === url ? "✓" : "⧉"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
