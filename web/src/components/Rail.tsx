import "./Rail.css";

export interface Stop {
  label: string;
  tx?: string | null;
  state: "done" | "active" | "pending" | "problem";
  sub?: string | null;
}

/**
 * The progress rail on the order page. One drawn line runs down the stops and extends as each
 * step lands; the active stop breathes until its transaction is in.
 */
export function Rail({ stops, explorer, viewLabel }: { stops: Stop[]; explorer: string; viewLabel: string }) {
  const done = stops.filter((s) => s.state === "done").length;
  const progress = stops.length > 1 ? Math.min(1, done / (stops.length - 1)) : 1;
  return (
    <ol className="rail" style={{ "--progress": progress } as never}>
      <span className="rail-line" aria-hidden>
        <span className="rail-ink" />
      </span>
      {stops.map((s, i) => (
        <li key={i} className={`rail-stop rail-stop--${s.state}`}>
          <span className="rail-dot" />
          <span className="rail-body">
            <strong>{s.label}</strong>
            {s.sub && <span className="rail-sub mono">{s.sub}</span>}
          </span>
          {s.tx && (
            <a className="rail-link mono" href={`${explorer}/tx/${s.tx}`} target="_blank" rel="noreferrer">
              {viewLabel} ↗
            </a>
          )}
        </li>
      ))}
    </ol>
  );
}
