import "./Rail.css";

export interface Stop {
  label: string;
  tx?: string | null;
  state: "done" | "active" | "pending" | "problem";
  sub?: string | null;
}

/** The progress rail on the order page: one stop per step, each lit when its transaction landed. */
export function Rail({ stops, explorer, viewLabel }: { stops: Stop[]; explorer: string; viewLabel: string }) {
  return (
    <ol className="rail">
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
