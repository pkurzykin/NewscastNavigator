type StoryTab = "scenario" | "production" | "history";
type ProductionContext = "video" | "titles";

const tabs: Array<{ key: StoryTab; label: string }> = [
  { key: "scenario", label: "Сценарий" },
  { key: "production", label: "Производство" },
  { key: "history", label: "История" },
];

interface Props {
  storyId: number;
  activeTab: StoryTab;
  scenarioContexts?: ProductionContext[];
}

export default function StoryTabs({ storyId, activeTab, scenarioContexts = [] }: Props) {
  const scenarioSearch = new URLSearchParams();
  scenarioContexts.forEach((context) => scenarioSearch.append("production_context", context));
  const scenarioHref = `/stories/${storyId}/scenario${scenarioSearch.size ? `?${scenarioSearch.toString()}` : ""}`;
  return (
    <nav className="story-tabs" aria-label="Разделы сюжета">
      {tabs.map((tab) => (
        <a
          key={tab.key}
          href={tab.key === "scenario" ? scenarioHref : `/stories/${storyId}/${tab.key}`}
          aria-current={activeTab === tab.key ? "page" : undefined}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );
}
