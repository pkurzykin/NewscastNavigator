export type ProjectPriorityLevel = "urgent" | "high" | "normal" | "low";

interface PriorityBadgeProps {
  level: ProjectPriorityLevel;
  label: string;
  reason: string;
}

export default function PriorityBadge({ level, label, reason }: PriorityBadgeProps) {
  return (
    <span className={`priority-badge priority-badge-${level}`}>
      <strong>Приоритет: {label}</strong>
      <span>{reason}</span>
    </span>
  );
}
