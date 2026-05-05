import type { ReactNode } from "react";

interface ProjectHistoryTabProps {
  children: ReactNode;
}

export default function ProjectHistoryTab({ children }: ProjectHistoryTabProps) {
  return <section className="project-card-tab-panel project-card-history-tab">{children}</section>;
}
