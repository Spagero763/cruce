import { useRef, type ElementType } from "react";
import { gsap, prefersReducedMotion, SplitText, useGSAP } from "../lib/motion";

/** Words rise into place line by line from behind a mask. Accepts inline <em> for accents. */
export function Reveal({
  html,
  as: Tag = "h2",
  className = "",
  onScroll = true,
  delay = 0,
}: {
  html: string;
  as?: ElementType;
  className?: string;
  onScroll?: boolean;
  delay?: number;
}) {
  const ref = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      if (!ref.current || prefersReducedMotion()) return;
      const split = SplitText.create(ref.current, { type: "lines,words", mask: "lines" });
      gsap.fromTo(
        split.words,
        { yPercent: 110, rotate: 4 },
        {
          yPercent: 0,
          rotate: 0,
          duration: 1.1,
          ease: "hold",
          stagger: 0.035,
          delay,
          scrollTrigger: onScroll ? { trigger: ref.current, start: "top 85%", once: true } : undefined,
        },
      );
      return () => split.revert();
    },
    { scope: ref, dependencies: [html] },
  );

  return <Tag ref={ref} className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
