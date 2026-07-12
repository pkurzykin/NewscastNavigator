type StoryTab = "scenario" | "production" | "history";

const tabs: Array<{ key: StoryTab; label: string }> = [
  { key: "scenario", label: "Сценарий" },
  { key: "production", label: "Производство" },
  { key: "history", label: "История" },
];

export default function StoryTabs({ storyId, activeTab }: { storyId: number; activeTab: StoryTab }) {
  return (
    <nav className="story-tabs" aria-label="Разделы сюжета">
      {tabs.map((tab) => (
        <a key={tab.key} href={`/stories/${storyId}/${tab.key}`} aria-current={activeTab === tab.key ? "page" : undefined}>
          {tab.label}
        </a>
      ))}
    </nav>
  );
}
