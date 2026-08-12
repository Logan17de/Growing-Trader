import { Icon, type IconName } from "@/components/terminal/Icon";

export function EmptyState({ icon = "database", title, description, compact = false }: { icon?: IconName; title: string; description: string; compact?: boolean }) {
  return <div className={`empty-state${compact ? " compact" : ""}`}><Icon name={icon} /><div><strong>{title}</strong><p>{description}</p></div></div>;
}

export function BackendUnavailable({ title, description }: { title: string; description: string }) {
  return <div className="backend-unavailable"><span className="status-badge neutral"><span className="status-dot neutral" />Backend unavailable</span><div><strong>{title}</strong><p>{description}</p></div></div>;
}
