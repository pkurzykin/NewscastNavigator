interface StatusBadgeProps {
  tone?: "neutral" | "ok" | "warn" | "danger";
  children: string;
}

export default function StatusBadge({ tone = "neutral", children }: StatusBadgeProps) {
  return <span className={`status-badge status-badge-${tone}`}>{children}</span>;
}
