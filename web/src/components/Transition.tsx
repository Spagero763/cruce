// Page changes as a circle: a disc grows from the tap point, the page swaps underneath,
// and the disc folds away toward the opposite corner.
import { createContext, useCallback, useContext, useRef, type MouseEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { gsap, prefersReducedMotion, scrollToTop } from "../lib/motion";
import "./Transition.css";

type Navigate = (to: string, e?: MouseEvent | { clientX: number; clientY: number }) => void;

const Ctx = createContext<Navigate | null>(null);

export function TransitionProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const disc = useRef<HTMLDivElement>(null);
  const busy = useRef(false);

  const go = useCallback<Navigate>(
    (to, e) => {
      if (busy.current) return;
      if (prefersReducedMotion() || !disc.current) {
        navigate(to);
        scrollToTop();
        return;
      }
      busy.current = true;
      const x = e?.clientX ?? window.innerWidth / 2;
      const y = e?.clientY ?? window.innerHeight / 2;
      const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      gsap
        .timeline({ onComplete: () => void (busy.current = false) })
        .set(disc.current, { display: "block", clipPath: `circle(0px at ${x}px ${y}px)` })
        .to(disc.current, { clipPath: `circle(${radius}px at ${x}px ${y}px)`, duration: 0.7, ease: "power3.inOut" })
        .add(() => {
          navigate(to);
          scrollToTop();
        })
        .to(disc.current, {
          clipPath: `circle(0px at ${window.innerWidth - x}px ${window.innerHeight - y}px)`,
          duration: 0.75,
          ease: "power3.inOut",
          delay: 0.05,
        })
        .set(disc.current, { display: "none" });
    },
    [navigate],
  );

  return (
    <Ctx.Provider value={go}>
      {children}
      <div ref={disc} className="page-disc" aria-hidden>
        <svg viewBox="0 0 64 64" className="page-disc-mark">
          <path d="M14 22c10 0 14 20 36 20" />
          <path d="M14 42c10 0 14-20 36-20" />
        </svg>
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
