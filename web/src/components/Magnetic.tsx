import { useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { gsap, prefersReducedMotion, useGSAP } from "../lib/motion";
import { useTransitionNavigate } from "./Transition";
import "./Magnetic.css";

type Variant = "primary" | "ghost" | "ink";

/** Leans toward the pointer and fills with colour from the point it was entered. */
export function Magnetic({
  children,
  variant = "primary",
  to,
  className = "",
  ...rest
}: { children: ReactNode; variant?: Variant; to?: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const ref = useRef<HTMLButtonElement>(null);
  const navigate = useTransitionNavigate();

  useGSAP(
    () => {
      const el = ref.current;
      if (!el || prefersReducedMotion() || window.matchMedia("(hover: none)").matches) return;
      const fill = el.querySelector<HTMLElement>(".mag-fill")!;
      const label = el.querySelector<HTMLElement>(".mag-label")!;
      const x = gsap.quickTo(el, "x", { duration: 0.5, ease: "hold" });
      const y = gsap.quickTo(el, "y", { duration: 0.5, ease: "hold" });
      const lx = gsap.quickTo(label, "x", { duration: 0.6, ease: "hold" });
      const ly = gsap.quickTo(label, "y", { duration: 0.6, ease: "hold" });

      const move = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        x(dx * 0.28);
        y(dy * 0.38);
        lx(dx * 0.12);
        ly(dy * 0.16);
      };
      const enter = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        gsap.set(fill, { left: e.clientX - r.left, top: e.clientY - r.top });
        gsap.fromTo(fill, { scale: 0 }, { scale: 1, duration: 0.6, ease: "hold" });
      };
      const leave = () => {
        x(0);
        y(0);
        lx(0);
        ly(0);
        gsap.to(fill, { scale: 0, duration: 0.45, ease: "power2.in" });
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerenter", enter);
      el.addEventListener("pointerleave", leave);
      return () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerenter", enter);
        el.removeEventListener("pointerleave", leave);
      };
    },
    { scope: ref },
  );

  return (
    <button
      ref={ref}
      className={`mag mag--${variant} ${className}`}
      {...rest}
      onClick={(e) => {
        rest.onClick?.(e);
        if (to && !e.defaultPrevented) navigate(to, e);
      }}
    >
      <span className="mag-fill" aria-hidden />
      <span className="mag-label">{children}</span>
    </button>
  );
}

export function Arrow() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
