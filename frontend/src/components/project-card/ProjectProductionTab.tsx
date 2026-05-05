import type { ReactNode } from "react";

interface ProjectProductionTabProps {
  children: ReactNode;
}

export default function ProjectProductionTab({ children }: ProjectProductionTabProps) {
  return <section className="project-card-tab-panel project-card-production-tab">{children}</section>;
}
