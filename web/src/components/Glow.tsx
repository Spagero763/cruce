import { useRef, type ReactNode } from "react";
import { gsap, lite, prefersReducedMotion, useGSAP } from "../lib/motion";
import "./Glow.css";

/** A soft light that follows the pointer across a dark section. Nothing on phones. */
export function Glow({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el || lite() || prefersReducedMotion()) return;
      const light = el.querySelector<HTMLElement>(".glow-light")!;
      const x = gsap.quickTo(light, "x", { duration: 0.9, ease: "hold" });
      const y = gsap.quickTo(light, "y", { duration: 0.9, ease: "hold" });
      const move = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        x(e.clientX - r.left);
        y(e.clientY - r.top);
      };
      const show = () => gsap.to(light, { opacity: 1, duration: 0.6 });
      const hide = () => gsap.to(light, { opacity: 0, duration: 0.6 });
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerenter", show);
      el.addEventListener("pointerleave", hide);
      return () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerenter", show);
        el.removeEventListener("pointerleave", hide);
      };
    },
    { scope: ref },
  );

  return (
    <section ref={ref} className={`glow on-ink ${className}`}>
      <span className="glow-light" aria-hidden />
      {children}
    </section>
  );
}
