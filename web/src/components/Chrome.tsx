import { useRef } from "react";
import { shortAddress } from "../lib/format";
import { LANGS, useI18n } from "../lib/i18n";
import { gsap, prefersReducedMotion, ScrollTrigger, useGSAP } from "../lib/motion";
import { useWallet } from "../lib/wallet";
import { TLink } from "./Transition";
import "./Chrome.css";

export function Logo() {
  return (
    <span className="logo">
      <svg viewBox="0 0 64 64" aria-hidden className="logo-mark">
        <path className="logo-a" d="M14 22c10 0 14 20 36 20" />
        <path className="logo-b" d="M14 42c10 0 14-20 36-20" />
      </svg>
      <span className="logo-word">Cruce</span>
    </span>
  );
}

export function Nav() {
  const { t, lang, setLang } = useI18n();
  const wallet = useWallet();
  const ref = useRef<HTMLElement>(null);

  // Steps out of the way while reading down, comes back on the first scroll up.
  useGSAP(() => {
    if (prefersReducedMotion()) return;
    const show = gsap.quickTo(ref.current, "yPercent", { duration: 0.45, ease: "hold" });
    ScrollTrigger.create({
      start: 0,
      end: "max",
      onUpdate: (self) => show(self.direction === 1 && self.scroll() > 120 ? -120 : 0),
      onLeaveBack: () => show(0),
    });
  });

  return (
    <header ref={ref} className="nav">
      <div className="wrap nav-inner">
        <TLink to="/" className="nav-home">
          <Logo />
        </TLink>
        <nav className="nav-links">
          <TLink to="/#how" className="nav-link nav-link--how">
            {t("nav.how")}
          </TLink>
          <TLink to="/developers" className="nav-link">
            <span className="nav-long">{t("nav.dev")}</span>
            <span className="nav-short">{t("nav.dev.short")}</span>
          </TLink>
          {wallet.address && (
            <TLink to="/me" className="nav-link">
              <span className="nav-long">{t("nav.me")}</span>
              <span className="nav-short">{t("nav.me.short")}</span>
            </TLink>
          )}
        </nav>
        <div className="nav-tools">
          <div className="lang" role="group" aria-label="Language">
            {LANGS.map((l) => (
              <button key={l} className={`lang-btn ${l === lang ? "is-on" : ""}`} onClick={() => setLang(l)} aria-pressed={l === lang}>
                {l}
              </button>
            ))}
          </div>
          {wallet.address ? (
            <TLink to="/me" className="nav-wallet">
              <span className="nav-wallet-dot is-on" />
              <span className="nav-wallet-label">{shortAddress(wallet.address)}</span>
            </TLink>
          ) : (
            !wallet.isMiniPay && (
              <button className="nav-wallet" onClick={() => void wallet.connect().catch(() => {})} disabled={!wallet.canConnect}>
                <span className="nav-wallet-dot" />
                <span className="nav-wallet-label">{t("nav.connect")}</span>
              </button>
            )
          )}
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  const { t } = useI18n();
  return (
    <footer className="footer on-ink">
      <div className="wrap">
        <div className="footer-word display" aria-hidden>
          Cruce
        </div>
        <p className="footer-line">{t("footer.line")}</p>
      </div>
    </footer>
  );
}
