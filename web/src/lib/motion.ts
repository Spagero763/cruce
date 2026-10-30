import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { CustomEase } from "gsap/CustomEase";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { Flip } from "gsap/Flip";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import Lenis from "lenis";

gsap.registerPlugin(useGSAP, ScrollTrigger, SplitText, DrawSVGPlugin, MotionPathPlugin, Flip, CustomEase);

CustomEase.create("hold", "M0,0 C0.16,1 0.3,1 1,1");
// A small overshoot, like a coin settling.
CustomEase.create("press", "M0,0 C0.3,0 0.2,1.18 0.6,1.02 0.8,0.96 0.9,1 1,1");

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Phones and weak machines get the same design without the always-running effects: no smooth
 * scroll, no idle loops, no grain. Scroll reveals stay, they're cheap.
 */
export const lite = (() => {
  let value: boolean | null = null;
  return () => {
    if (value !== null) return value;
    if (typeof window === "undefined") return false;
    const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
    value =
      prefersReducedMotion() ||
      window.matchMedia("(pointer: coarse)").matches ||
      (nav.deviceMemory ?? 8) <= 4 ||
      (nav.hardwareConcurrency ?? 8) <= 4 ||
      Boolean(nav.connection?.saveData);
    if (value) document.documentElement.classList.add("lite");
    return value;
  };
})();

let lenis: Lenis | null = null;

export function startSmoothScroll(): Lenis | null {
  if (lenis || lite()) return lenis;
  lenis = new Lenis({ duration: 1.1, easing: (t) => 1 - Math.pow(1 - t, 4), touchMultiplier: 1.2 });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((time) => lenis?.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
  return lenis;
}

export function scrollToTop(): void {
  if (lenis) lenis.scrollTo(0, { immediate: true });
  else window.scrollTo(0, 0);
}

export { gsap, Flip, ScrollTrigger, SplitText, useGSAP };
