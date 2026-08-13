import { compareThreshold, type ThresholdOperator } from "@/lib/marketCalculations";

export type ThresholdRow = {
  label: string;
  live: number | null | undefined;
  required: number | null | undefined;
  operator: ThresholdOperator;
  liveLabel?: string;
  requiredLabel?: string;
};

function numeric(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-IN", { maximumFractionDigits: 3 }) : "—";
}

export function ThresholdComparison({ rows }: { rows: ThresholdRow[] }) {
  return <div className="threshold-table-wrap">
    <table className="threshold-table">
      <thead><tr><th>Parameter</th><th>Live value</th><th>Required threshold</th><th>Status</th></tr></thead>
      <tbody>{rows.map((row) => {
        const state = compareThreshold(row.live, row.required, row.operator);
        return <tr key={row.label}>
          <td>{row.label}</td>
          <td className="numeric">{row.liveLabel ?? numeric(row.live)}</td>
          <td className="numeric">{row.requiredLabel ?? `${row.operator} ${numeric(row.required)}`}</td>
          <td><span className={`threshold-state ${state}`}>{state}</span></td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}
