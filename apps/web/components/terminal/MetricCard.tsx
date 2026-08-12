import type { IconName } from "@/components/terminal/Icon";
import { Icon } from "@/components/terminal/Icon";

type Props = {
  label: string;
  value?: string;
  detail?: string;
  tone?: "neutral" | "positive" | "negative" | "warning" | "info";
  icon?: IconName;
  unavailable?: boolean;
};

export function MetricCard({ label, value, detail, tone = "neutral", icon, unavailable = false }: Props) {
  return <article className={`terminal-metric ${tone}${unavailable ? " unavailable" : ""}`}>
    <div className="terminal-metric-head"><span>{label}</span>{icon && <Icon name={icon} />}</div>
    <strong>{unavailable ? "Unavailable" : value ?? "—"}</strong>
    <small>{detail ?? (unavailable ? "Backend data is not exposed" : "Latest authenticated snapshot")}</small>
  </article>;
}
