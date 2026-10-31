import type { ReactNode } from "react";

// Small drawn flags and coins. Flag emoji don't render on Windows, so these are plain SVG.
const R = 8;

function Clip({ id, children }: { id: string; children: ReactNode }) {
  return (
    <svg className="currency-mark" viewBox="0 0 16 16" width="16" height="16" aria-hidden>
      <defs>
        <clipPath id={id}>
          <circle cx={R} cy={R} r={R} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id})`}>{children}</g>
      <circle cx={R} cy={R} r={R - 0.4} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="0.8" />
    </svg>
  );
}

const coin = (glyph: string, fill: string) => (
  <svg className="currency-mark" viewBox="0 0 16 16" width="16" height="16" aria-hidden>
    <circle cx={R} cy={R} r={R} fill={fill} />
    <text x={R} y={11.6} textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff" fontFamily="system-ui, sans-serif">
      {glyph}
    </text>
  </svg>
);

export function CurrencyMark({ code }: { code: string }) {
  switch (code) {
    case "wARS":
      return (
        <Clip id="cm-ar">
          <rect width="16" height="16" fill="#74acdf" />
          <rect y="5.33" width="16" height="5.34" fill="#fff" />
          <circle cx={R} cy={R} r="1.7" fill="#f6b40e" />
        </Clip>
      );
    case "wBRL":
      return (
        <Clip id="cm-br">
          <rect width="16" height="16" fill="#009c3b" />
          <path d="M8 2.6 14 8 8 13.4 2 8Z" fill="#ffdf00" />
          <circle cx={R} cy={R} r="2.7" fill="#002776" />
        </Clip>
      );
    case "wCOP":
      return (
        <Clip id="cm-co">
          <rect width="16" height="8" fill="#fcd116" />
          <rect y="8" width="16" height="4" fill="#003893" />
          <rect y="12" width="16" height="4" fill="#ce1126" />
        </Clip>
      );
    case "wMXN":
      return (
        <Clip id="cm-mx">
          <rect width="5.33" height="16" fill="#006847" />
          <rect x="5.33" width="5.34" height="16" fill="#fff" />
          <rect x="10.67" width="5.33" height="16" fill="#ce1126" />
          <circle cx={R} cy={R} r="1.6" fill="#8a6d3b" />
        </Clip>
      );
    case "wCLP":
      return (
        <Clip id="cm-cl">
          <rect width="16" height="8" fill="#fff" />
          <rect y="8" width="16" height="8" fill="#d52b1e" />
          <rect width="6" height="8" fill="#0039a6" />
          <path d="M3 1.8 3.5 3.2 5 3.2 3.8 4.1 4.2 5.5 3 4.7 1.8 5.5 2.2 4.1 1 3.2 2.5 3.2Z" fill="#fff" />
        </Clip>
      );
    case "wPEN":
      return (
        <Clip id="cm-pe">
          <rect width="5.33" height="16" fill="#d91023" />
          <rect x="5.33" width="5.34" height="16" fill="#fff" />
          <rect x="10.67" width="5.33" height="16" fill="#d91023" />
        </Clip>
      );
    case "IDRX":
      return (
        <Clip id="cm-id">
          <rect width="16" height="8" fill="#ce1126" />
          <rect y="8" width="16" height="8" fill="#fff" />
        </Clip>
      );
    case "cNGN":
      return (
        <Clip id="cm-ng">
          <rect width="5.33" height="16" fill="#008751" />
          <rect x="5.33" width="5.34" height="16" fill="#fff" />
          <rect x="10.67" width="5.33" height="16" fill="#008751" />
        </Clip>
      );
    case "USAT":
      return (
        <Clip id="cm-us">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <rect key={i} y={i * 2.29} width="16" height="2.29" fill={i % 2 ? "#fff" : "#b22234"} />
          ))}
          <rect width="7.5" height="8" fill="#3c3b6e" />
        </Clip>
      );
    case "USDC":
      return coin("$", "#3a6fd8");
    case "USDm":
      return coin("m", "#2bb673");
    default:
      return coin("₮", "#2a9d78");
  }
}
