import { memo, useRef } from "react";
import { gsap, lite, prefersReducedMotion, useGSAP } from "../lib/motion";
import { CurrencyMark } from "./CurrencyMark";
import "./Crossing.css";

/**
 * The brand picture: two currencies cross through the dollar. On a change of pair the discs
 * trade places, one passing over the hub and one under, and the hub pulses as they meet.
 * The order page walks the same discs through the hub step by step with `stage`.
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
  /** 0 at rest, 1 the first disc has gone in, 2 the second is out. */
  stage?: 0 | 1 | 2;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  useGSAP(
    () => {
      if (first.current || prefersReducedMotion() || lite()) {
        first.current = false;
        return;
      }
      const a = root.current!.querySelector<HTMLElement>(".x-disc--a")!;
      const b = root.current!.querySelector<HTMLElement>(".x-disc--b")!;
      const hub = root.current!.querySelector<HTMLElement>(".x-hub")!;
      const lift = root.current!.clientHeight * 0.28;
      const tl = gsap.timeline({ defaults: { duration: 0.7, ease: "sine.inOut" } });
      tl.fromTo(a, { left: "85%" }, { left: "15%", duration: 1.4, ease: "power2.inOut" }, 0)
        .fromTo(b, { left: "15%" }, { left: "85%", duration: 1.4, ease: "power2.inOut" }, 0)
        .fromTo(a, { y: 0 }, { y: -lift, ease: "sine.out" }, 0)
        .to(a, { y: 0, ease: "sine.in" }, 0.7)
        .fromTo(b, { y: 0 }, { y: lift, ease: "sine.out" }, 0)
        .to(b, { y: 0, ease: "sine.in" }, 0.7)
        .fromTo(hub, { scale: 1 }, { scale: 1.35, duration: 0.3, ease: "press", yoyo: true, repeat: 1 }, 0.55);
    },
    { scope: root, dependencies: [from, to] },
  );

  return (
    <div ref={root} className={`x x--${size} ${className}`} data-stage={stage} aria-hidden>
      <svg className="x-svg" viewBox="0 0 400 200">
        <path className="x-track" d="M60 100c70 0 100-60 140-60s70 60 140 60" />
        <path className="x-track" d="M60 100c70 0 100 60 140 60s70-60 140-60" />
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
