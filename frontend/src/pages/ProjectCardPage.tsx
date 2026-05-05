import { useEffect, useState, type ReactNode } from "react";

import ProjectCardHeader from "../components/project-card/ProjectCardHeader";
import ProjectCardTabs, {
  type ProjectCardTab,
} from "../components/project-card/ProjectCardTabs";
import ProjectCommentsTab from "../components/project-card/ProjectCommentsTab";
import ProjectHistoryTab from "../components/project-card/ProjectHistoryTab";
import ProjectMaterialsTab from "../components/project-card/ProjectMaterialsTab";
import ProjectOverviewTab from "../components/project-card/ProjectOverviewTab";
import ProjectProductionTab from "../components/project-card/ProjectProductionTab";
import { fetchProjects } from "../shared/api";
import type { ProjectListItem, UserPublic } from "../shared/types";

const EMPTY_PROJECT_FILTERS = {
  search: "",
  status: [],
  rubric: "",
  participant: "",
  created_from: "",
  created_to: "",
  archived_by: "",
  archived_from: "",
  archived_to: "",
};

interface ProjectCardPageProps {
  token: string;
  projectId: number;
  user: UserPublic;
  onBackToMain: () => void;
  renderProjectSection: (section: ProjectCardEditorSection) => ReactNode;
}

export type ProjectCardEditorSection =
  | "text"
  | "comments"
  | "materials"
  | "production"
  | "history";

export default function ProjectCardPage({
  token,
  projectId,
  user: _user,
  onBackToMain,
  renderProjectSection,
}: ProjectCardPageProps) {
  const [project, setProject] = useState<ProjectListItem | null>(null);
  const [activeTab, setActiveTab] = useState<ProjectCardTab>("overview");

  useEffect(() => {
    let alive = true;

    void (async () => {
      const response = await fetchProjects("main", EMPTY_PROJECT_FILTERS, token);
      if (!alive) {
        return;
      }
      setProject(response.items.find((item) => item.id === projectId) || null);
    })();

    return () => {
      alive = false;
    };
  }, [projectId, token]);

  if (!project) {
    return <p className="muted">Загрузка карточки сюжета...</p>;
  }

  return (
    <section className="project-card-page">
      <ProjectCardHeader project={project} onBack={onBackToMain} />
      <ProjectCardTabs activeTab={activeTab} onChange={setActiveTab} />
      {activeTab === "overview" ? (
        <ProjectOverviewTab
          project={project}
          user={_user}
          onOpenText={() => setActiveTab("text")}
        />
      ) : null}
      {activeTab === "text" ? (
        <div className="project-card-text-tab">{renderProjectSection("text")}</div>
      ) : null}
      {activeTab === "comments" ? (
        <ProjectCommentsTab>{renderProjectSection("comments")}</ProjectCommentsTab>
      ) : null}
      {activeTab === "materials" ? (
        <ProjectMaterialsTab>{renderProjectSection("materials")}</ProjectMaterialsTab>
      ) : null}
      {activeTab === "production" ? (
        <ProjectProductionTab>{renderProjectSection("production")}</ProjectProductionTab>
      ) : null}
      {activeTab === "history" ? (
        <ProjectHistoryTab>{renderProjectSection("history")}</ProjectHistoryTab>
      ) : null}
    </section>
  );
}
