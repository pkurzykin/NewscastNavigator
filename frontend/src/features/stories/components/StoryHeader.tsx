import type { StoryListItem } from "../types";

type StoryHeaderItem = Pick<
  StoryListItem,
  "title" | "priority" | "rubric" | "author" | "situation"
>;

export default function StoryHeader({ story }: { story: StoryHeaderItem }) {
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
