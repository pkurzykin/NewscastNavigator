import type { StoryListItem } from "../types";

export default function StoryHeader({ story }: { story: StoryListItem }) {
  return (
    <header className="story-header">
      <div>
        <p className="muted small">{story.rubric.name} · {story.priority.label}</p>
        <h2>{story.title}</h2>
        <p className="muted">Автор: {story.author.display_name} · {story.situation.label}</p>
      </div>
    </header>
  );
}
