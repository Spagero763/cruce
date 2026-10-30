// Page changes as a crossing: two diagonal bands slide past each other in opposite directions,
// the page swaps while they overlap, and the gap between them reveals the next one.
import { createContext, useCallback, useContext, useRef, type MouseEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { gsap, prefersReducedMotion, scrollToTop } from "../lib/motion";
import "./Transition.css";

type Navigate = (to: string, e?: MouseEvent | { clientX: number; clientY: number }) => void;

const Ctx = createContext<Navigate | null>(null);

export function TransitionProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const root = useRef<HTMLDivElement>(null);
  const busy = useRef(false);

  const go = useCallback<Navigate>(
    (to) => {
      if (busy.current) return;
      if (prefersReducedMotion() || !root.current) {
        navigate(to);
        scrollToTop();
        return;
      }
      busy.current = true;
      const [a, b] = Array.from(root.current.querySelectorAll<HTMLElement>(".band"));
      gsap
        .timeline({ defaults: { ease: "power3.inOut" }, onComplete: () => void (busy.current = false) })
        .set(root.current, { display: "block" })
        .fromTo(a, { xPercent: -130 }, { xPercent: 0, duration: 0.55 }, 0)
        .fromTo(b, { xPercent: 130 }, { xPercent: 0, duration: 0.55 }, 0.06)
        .add(() => {
          navigate(to);
          scrollToTop();
        })
        .to(a, { xPercent: 130, duration: 0.6 }, "+=0.08")
        .to(b, { xPercent: -130, duration: 0.6 }, "<0.06")
        .set(root.current, { display: "none" });
    },
    [navigate],
  );

  return (
    <Ctx.Provider value={go}>
      {children}
      <div ref={root} className="bands" aria-hidden>
        <div className="band band--a" />
        <div className="band band--b" />
      </div>
    </Ctx.Provider>
  );
}

export function useTransitionNavigate(): Navigate {
  const go = useContext(Ctx);
  if (!go) throw new Error("useTransitionNavigate outside TransitionProvider");
  return go;
}

export function TLink({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  const go = useTransitionNavigate();
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        go(to, e);
      }}
    >
      {children}
    </a>
  );
}
