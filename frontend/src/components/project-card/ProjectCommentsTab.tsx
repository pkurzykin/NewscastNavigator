import type { ReactNode } from "react";

interface ProjectCommentsTabProps {
  children: ReactNode;
}

export default function ProjectCommentsTab({ children }: ProjectCommentsTabProps) {
  return <section className="project-card-tab-panel project-card-comments-tab">{children}</section>;
}
