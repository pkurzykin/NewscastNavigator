import { useEffect, useState, type ReactNode } from "react";

import ProjectCardHeader from "../components/project-card/ProjectCardHeader";
import ProjectCardTabs, {
  type ProjectCardTab,
} from "../components/project-card/ProjectCardTabs";
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
  renderTextEditor: () => ReactNode;
}

export default function ProjectCardPage({
  token,
  projectId,
  user: _user,
  onBackToMain,
  renderTextEditor,
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

  void _user;

  if (!project) {
    return <p className="muted">Загрузка карточки сюжета...</p>;
  }

  return (
    <section className="project-card-page">
      <ProjectCardHeader project={project} onBack={onBackToMain} />
      <ProjectCardTabs activeTab={activeTab} onChange={setActiveTab} />
      {activeTab === "overview" ? (
        <div className="card">Обзор будет добавлен следующим шагом.</div>
      ) : null}
      {activeTab === "text" ? renderTextEditor() : null}
      {activeTab !== "overview" && activeTab !== "text" ? (
        <div className="card">
          Раздел будет перенесен из текущего редактора отдельным шагом.
        </div>
      ) : null}
    </section>
  );
}
