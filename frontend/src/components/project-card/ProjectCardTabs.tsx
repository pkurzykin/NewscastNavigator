export type ProjectCardTab =
  | "overview"
  | "text"
  | "comments"
  | "materials"
  | "production"
  | "history";

interface ProjectCardTabsProps {
  activeTab: ProjectCardTab;
  onChange: (tab: ProjectCardTab) => void;
}

const TABS: Array<{ key: ProjectCardTab; label: string }> = [
  { key: "overview", label: "Обзор" },
  { key: "text", label: "Текст" },
  { key: "comments", label: "Правки" },
  { key: "materials", label: "Материалы" },
  { key: "production", label: "Производство" },
  { key: "history", label: "История" },
];

export default function ProjectCardTabs({
  activeTab,
  onChange,
}: ProjectCardTabsProps) {
  return (
    <nav className="project-card-tabs" aria-label="Разделы карточки">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={
            tab.key === activeTab ? "project-card-tab active" : "project-card-tab"
          }
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
