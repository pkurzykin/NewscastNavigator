import type { ReactNode } from "react";

interface ProjectMaterialsTabProps {
  children: ReactNode;
}

export default function ProjectMaterialsTab({ children }: ProjectMaterialsTabProps) {
  return <section className="project-card-tab-panel project-card-materials-tab">{children}</section>;
}
