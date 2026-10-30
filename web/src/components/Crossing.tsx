import { memo, useEffect, useRef } from "react";
import { gsap, lite, prefersReducedMotion, useGSAP } from "../lib/motion";
import { CurrencyMark } from "./CurrencyMark";
import "./Crossing.css";

/**
 * The brand picture: two currencies cross through the dollar. `from` rides the upper arc to
 * the right, `to` rides the lower arc to the left, and the hub pulses when they pass. Each
 * change of pair plays it once. On lite devices the discs sit at rest.
 */
export const Crossing = memo(function Crossing({
  from,
  to,
  size = "lg",
  stage = 0,
  className = "",
}: {
  from: string;
  to: string;
  size?: "sm" | "md" | "lg";
  /** 0 at rest, 1 the first disc has gone in, 2 the second is out. Drives the order page. */
  stage?: 0 | 1 | 2;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  useGSAP(
    () => {
      const a = root.current!.querySelector<HTMLElement>(".x-disc--a")!;
      const b = root.current!.querySelector<HTMLElement>(".x-disc--b")!;
      const hub = root.current!.querySelector<HTMLElement>(".x-hub")!;
      const still = prefersReducedMotion() || lite();
      if (first.current || still) {
        first.current = false;
        gsap.set(a, { xPercent: 0, yPercent: 0 });
        gsap.set(b, { xPercent: 0, yPercent: 0 });
        return;
      }
      const tl = gsap.timeline({ defaults: { duration: 1.4, ease: "hold" } });
      tl.fromTo(a, { xPercent: 0 }, { motionPath: { path: ".x-path-a", align: ".x-path-a", alignOrigin: [0.5, 0.5] } }, 0)
        .fromTo(b, { xPercent: 0 }, { motionPath: { path: ".x-path-b", align: ".x-path-b", alignOrigin: [0.5, 0.5] } }, 0)
        .fromTo(hub, { scale: 1 }, { scale: 1.35, duration: 0.35, ease: "press", yoyo: true, repeat: 1 }, 0.5)
        .set([a, b], { clearProps: "transform" });
    },
    { scope: root, dependencies: [from, to] },
  );

  useEffect(() => {
    root.current?.style.setProperty("--stage", String(stage));
  }, [stage]);

  return (
    <div ref={root} className={`x x--${size} ${className}`} data-stage={stage} aria-hidden>
      <svg className="x-svg" viewBox="0 0 400 200">
        <path className="x-track" d="M60 100c70 0 100-60 140-60s70 60 140 60" />
        <path className="x-track" d="M60 100c70 0 100 60 140 60s70-60 140-60" />
        <path className="x-path-a" d="M60 100c70 0 100-60 140-60s70 60 140 60" fill="none" stroke="none" />
        <path className="x-path-b" d="M340 100c-70 0-100 60-140 60s-70-60-140-60" fill="none" stroke="none" />
      </svg>
      <div className="x-hub mono">$</div>
      <div className="x-disc x-disc--a">
        <CurrencyMark code={from} />
      </div>
      <div className="x-disc x-disc--b">
        <CurrencyMark code={to} />
      </div>
    </div>
  );
});
