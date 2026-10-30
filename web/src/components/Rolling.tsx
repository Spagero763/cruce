import { memo, useEffect, useRef, useState } from "react";
import "./Rolling.css";

const DIGITS = "0123456789";

/**
 * A number whose digits roll into place like a departures board. Each digit is a column of ten;
 * a change slides the column, so a new price is read as motion rather than a swap.
 */
export const Rolling = memo(function Rolling({ value, className = "" }: { value: string; className?: string }) {
  const [shown, setShown] = useState(value);
  const prev = useRef(value);

  useEffect(() => {
    prev.current = shown;
    setShown(value);
  }, [value, shown]);

  const chars = Array.from(shown);
  return (
    <span className={`roll ${className}`} aria-label={shown}>
      {chars.map((ch, i) => {
        const d = DIGITS.indexOf(ch);
        if (d === -1) {
          return (
            <span key={`${i}-${ch}`} className="roll-char" aria-hidden>
              {ch}
            </span>
          );
        }
        return (
          <span key={i} className="roll-col" aria-hidden>
            <span className="roll-track" style={{ transform: `translateY(-${d * 10}%)` }}>
              {Array.from(DIGITS).map((n) => (
                <span key={n} className="roll-digit">
                  {n}
                </span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
});
