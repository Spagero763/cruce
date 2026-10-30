import { forwardRef, memo, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Converter } from "../components/Converter";
import { Crossing } from "../components/Crossing";
import { CurrencyMark } from "../components/CurrencyMark";
import { Glow } from "../components/Glow";
import { LiveActivity } from "../components/LiveActivity";
import { Magnetic, Arrow } from "../components/Magnetic";
import { Reveal } from "../components/Reveal";
import { api, type AppConfig, type Quote } from "../lib/api";
import { money } from "../lib/format";
import { useI18n, type Key } from "../lib/i18n";
import { gsap, lite, prefersReducedMotion, ScrollTrigger, useGSAP } from "../lib/motion";
import "./Landing.css";
import "./app.css";

const MARQUEE = ["wARS", "wBRL", "cNGN", "wCOP", "USAT", "USDT", "USDC", "wMXN", "wCLP", "wPEN"];
const LABEL: Record<string, string> = { USAT: "USA₮", USDT: "USD₮" };

/** The crossing that follows the story. It owns its stage so a scroll step re-renders only this. */
const StoryStage = forwardRef<{ set(i: number): void }, { eyebrow: string }>(function StoryStage({ eyebrow }, ref) {
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  useImperativeHandle(ref, () => ({ set: (i) => setStage(Math.min(2, i) as 0 | 1 | 2) }), []);
  return (
    <div className="story-stage">
      <p className="eyebrow">{eyebrow}</p>
      <Crossing from="wARS" to="wBRL" size="md" stage={stage} />
      <div className="story-progress mono">
        {[1, 2, 3].map((n) => (
          <span key={n} className={n <= stage + 1 ? "is-on" : ""}>
            0{n}
          </span>
        ))}
      </div>
    </div>
  );
});

const Marquee = memo(function Marquee() {
  return (
    <section className="marquee" aria-hidden>
      <div className="marquee-track">
        {[...MARQUEE, ...MARQUEE, ...MARQUEE, ...MARQUEE].map((m, i) => (
          <span key={i} className="marquee-item display">
            <CurrencyMark code={m} /> {LABEL[m] ?? m} <i>✺</i>
          </span>
        ))}
      </div>
    </section>
  );
});

export function Landing() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const stageRef = useRef<{ set(i: number): void }>(null);
  const quoteRef = useRef<Quote | null>(null);
  const [pair, setPair] = useState<{ from: string; to: string }>({ from: "wARS", to: "wBRL" });

  useEffect(() => {
    void api.config().then(setConfig).catch(() => {});
  }, []);

  // The first screen is dark: the nav knows while it is over it.
  useEffect(() => {
    document.body.classList.add("hero-dark");
    return () => document.body.classList.remove("hero-dark");
  }, []);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      const light = lite();
      gsap.fromTo(".hero-body", { y: 20, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 1, ease: "hold", delay: 0.5 });
      gsap.fromTo(".hero-cv", { y: 40, autoAlpha: 0, scale: 0.98 }, { y: 0, autoAlpha: 1, scale: 1, duration: 1.3, ease: "hold", delay: 0.35 });

      ScrollTrigger.create({
        trigger: ".hero",
        start: "top 60px",
        end: "bottom 60px",
        onToggle: (self) => document.body.classList.toggle("hero-dark", self.isActive),
      });

      // Scrolling out of the hero drives the crossing: the discs trade places through the dollar and
      // the amount received counts up with them. Scrubbed, so it reads at whatever pace you scroll.
      const a = root.current!.querySelector<HTMLElement>(".hero-cross .x-disc--a");
      const b = root.current!.querySelector<HTMLElement>(".hero-cross .x-disc--b");
      const hub = root.current!.querySelector<HTMLElement>(".hero-cross .x-hub");
      const count = root.current!.querySelector<HTMLElement>(".hero-count");
      if (a && b && hub && count && !light) {
        const n = { p: 0 };
        const lift = (a.parentElement?.clientHeight ?? 200) * 0.28;
        gsap
          .timeline({ scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: 0.6 } })
          .fromTo(a, { left: "15%" }, { left: "85%", ease: "none" }, 0)
          .fromTo(b, { left: "85%" }, { left: "15%", ease: "none" }, 0)
          .fromTo(a, { y: 0 }, { y: -lift, duration: 0.5, ease: "sine.out" }, 0)
          .to(a, { y: 0, duration: 0.5, ease: "sine.in" }, 0.5)
          .fromTo(b, { y: 0 }, { y: lift, duration: 0.5, ease: "sine.out" }, 0)
          .to(b, { y: 0, duration: 0.5, ease: "sine.in" }, 0.5)
          .fromTo(hub, { scale: 1 }, { scale: 1.4, duration: 0.5, ease: "none" }, 0)
          .to(hub, { scale: 1, duration: 0.5, ease: "none" }, 0.5)
          .to(
            n,
            {
              p: 1,
              ease: "none",
              onUpdate: () => {
                const q = quoteRef.current;
                const cur = config?.currencies.find((c) => c.code === q?.to);
                count.style.opacity = n.p > 0.03 && q ? "1" : "0";
                if (q && cur) count.textContent = money((BigInt(q.estOut) * BigInt(Math.round(n.p * 1000))) / 1000n, cur);
              },
            },
            0,
          );
      }

      const track = root.current!.querySelector<HTMLElement>(".marquee-track")!;
      const loop = gsap.to(track, { xPercent: -50, duration: light ? 40 : 28, ease: "none", repeat: -1 });
      if (!light) {
        const skew = gsap.quickTo(track, "skewX", { duration: 0.5, ease: "hold" });
        ScrollTrigger.create({
          trigger: ".marquee",
          start: "top bottom",
          end: "bottom top",
          onUpdate: (self) => {
            const v = self.getVelocity();
            loop.timeScale(1 + Math.min(Math.abs(v) / 600, 4));
            skew(gsap.utils.clamp(-12, 12, v / -120));
          },
        });
      }

      gsap.fromTo(
        ".why-card",
        { y: 60, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, duration: 1.1, ease: "hold", stagger: 0.1, scrollTrigger: { trigger: ".why-grid", start: "top 80%", once: true } },
      );
      gsap.fromTo(
        ".devs .code",
        { y: 120, rotate: -8, autoAlpha: 0 },
        { y: 0, rotate: -1.5, autoAlpha: 1, duration: 1.4, ease: "hold", scrollTrigger: { trigger: ".devs", start: "top 75%", once: true } },
      );
      gsap.fromTo(
        ".cta-ring",
        { scale: 0.4, rotate: -120 },
        { scale: 1.15, rotate: 0, ease: "none", scrollTrigger: { trigger: ".cta", start: "top bottom", end: "bottom top", scrub: 1 } },
      );
    },
    { scope: root, dependencies: [config] },
  );

  // The crossing stays pinned while you scroll through one conversion, a step at a time.
  useGSAP(
    () => {
      const steps = gsap.utils.toArray<HTMLElement>(".story-step");
      let current = -1;
      const activate = (i: number) => {
        if (i === current) return;
        current = i;
        stageRef.current?.set(i);
        steps.forEach((s, j) => s.classList.toggle("is-active", j === i));
      };
      const mm = gsap.matchMedia();
      mm.add("(min-width: 900px) and (prefers-reduced-motion: no-preference)", () => {
        ScrollTrigger.create({ trigger: ".story", start: "top top", end: "bottom bottom", pin: ".story-stage" });
        steps.forEach((s, j) => ScrollTrigger.create({ trigger: s, start: "top 50%", end: "bottom 50%", onToggle: (self) => self.isActive && activate(j) }));
      });
      mm.add("(max-width: 899px), (prefers-reduced-motion: reduce)", () => {
        steps.forEach((s, j) => ScrollTrigger.create({ trigger: s, start: "top 60%", end: "bottom 40%", onToggle: (self) => self.isActive && activate(j) }));
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  const story: [Key, Key][] = [
    ["story.1.title", "story.1.body"],
    ["story.2.title", "story.2.body"],
    ["story.3.title", "story.3.body"],
  ];
  const why: [Key, Key][] = [
    ["why.a.title", "why.a.body"],
    ["why.b.title", "why.b.body"],
    ["why.c.title", "why.c.body"],
    ["why.d.title", "why.d.body"],
  ];

  return (
    <div ref={root} className="landing">
      <Glow className="hero-glow">
        <section className="hero wrap">
          <div className="hero-copy">
            <p className="eyebrow">{t("hero.kicker")}</p>
            <Reveal as="h1" className="display hero-title" html={t("hero.title")} onScroll={false} delay={0.15} />
            <p className="hero-body">{t("hero.body")}</p>
            <div className="hero-cross-wrap">
              <Crossing from={pair.from} to={pair.to} size="md" className="hero-cross" />
              <span className="hero-count display" aria-hidden />
            </div>
          </div>
          <div className="hero-visual">
            {config && (
              <Converter
                config={config}
                className="hero-cv"
                start={{ from: params.get("from") ?? undefined, to: params.get("to") ?? undefined, amount: params.get("amount") ?? undefined, partner: params.get("ref") }}
                onQuote={(q) => {
                  quoteRef.current = q;
                  if (q && (q.from !== pair.from || q.to !== pair.to)) setPair({ from: q.from, to: q.to });
                }}
              />
            )}
          </div>
        </section>
      </Glow>

      <Marquee />

      <section id="how" className="story">
        <div className="wrap story-grid">
          <StoryStage ref={stageRef} eyebrow={t("story.eyebrow")} />
          <ol className="story-steps">
            {story.map(([title, body], i) => (
              <li key={title} className={`story-step ${i === 0 ? "is-active" : ""}`}>
                <span className="story-num mono">0{i + 1}</span>
                <h3 className="display">{t(title)}</h3>
                <p>{t(body)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="why wrap">
        <p className="eyebrow">{t("why.eyebrow")}</p>
        <Reveal className="display why-title" html={t("why.title")} />
        <div className="why-grid">
          {why.map(([title, body], i) => (
            <article key={title} className="why-card">
              <WhyIcon i={i} />
              <h3>{t(title)}</h3>
              <p>{t(body)}</p>
            </article>
          ))}
        </div>
      </section>

      <LiveActivity />

      <Glow className="devs">
        <div className="wrap devs-grid">
          <div>
            <p className="eyebrow">{t("dev.eyebrow")}</p>
            <Reveal className="display devs-title" html={t("dev.title")} />
            <p className="devs-body">{t("dev.body")}</p>
            <Magnetic to="/developers" variant="ink">
              {t("dev.cta")} <Arrow />
            </Magnetic>
          </div>
          <pre className="code" aria-hidden>
            <span className="c">{"// one call quotes, one payment settles"}</span>
            {"\n"}
            <span className="k">const</span> cruce = <span className="k">new</span> Cruce({"{"} partner: <span className="s">"your-code"</span> {"}"});{"\n"}
            <span className="k">const</span> q = <span className="k">await</span> cruce.quote({"{"} from: <span className="s">"wARS"</span>, to: <span className="s">"wBRL"</span>, amount: <span className="s">"50000"</span> {"}"});{"\n"}
            <span className="k">const</span> order = <span className="k">await</span> cruce.pay(q, {"{"} wallet, recipient {"}"});{"\n"}
            <span className="c">{"// order.status === \"done\", legs with their txs"}</span>
          </pre>
        </div>
      </Glow>

      <section className="cta">
        <svg className="cta-ring" viewBox="0 0 400 200" aria-hidden>
          <path d="M20 100c90 0 120-80 180-80s90 80 180 80" />
          <path d="M20 100c90 0 120 80 180 80s90-80 180-80" />
        </svg>
        <div className="wrap cta-inner">
          <Reveal className="display cta-title" html={t("cta.title")} />
          <Magnetic variant="ink" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            {t("cta.cta")} <Arrow />
          </Magnetic>
        </div>
      </section>
    </div>
  );
}

const WHY_ICONS = [
  <>
    <path key="a" d="M4 16c5 0 7-8 12-8h4m0 0-3-3m3 3-3 3" />
    <path d="M4 8c5 0 7 8 12 8h4m0 0-3-3m3 3-3 3" />
  </>,
  <>
    <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
    <path d="M9 12l2 2 4-4" />
  </>,
  <>
    <rect x="3" y="6" width="18" height="12" rx="3" />
    <path d="M3 10h18M7 15h3" />
  </>,
  <>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 7v5l3 2" />
  </>,
];

function WhyIcon({ i }: { i: number }) {
  return (
    <svg className="why-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {WHY_ICONS[i]}
    </svg>
  );
}
