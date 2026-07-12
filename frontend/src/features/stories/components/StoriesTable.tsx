import type { StoryListItem } from "../types";

interface StoriesTableProps {
  items: StoryListItem[];
  onOpenScenario: (storyId: number) => void;
}

function assigneeSummary(item: StoryListItem): string {
  if (item.assignments.length === 0) return "Не назначены";
  if (item.assignments.length > 2) return `Исполнителей: ${item.assignments.length}`;
  return item.assignments.map((assignment) => `${assignment.user.position}: ${assignment.user.display_name}`).join(" · ");
}

export default function StoriesTable({ items, onOpenScenario }: StoriesTableProps) {
  return (
    <div className="stories-table-wrap">
      <table className="stories-table">
        <thead>
          <tr>
            <th>Приоритет</th>
            <th>Название</th>
            <th>Рубрика</th>
            <th>Автор</th>
            <th>Что происходит</th>
            <th>Исполнители</th>
          </tr>
        </thead>
        <tbody>
          {items.map((story) => (
            <tr key={story.id}>
              <td><span className={`story-priority story-priority-${story.priority.code}`}>{story.priority.label}</span></td>
              <td>
                <a
                  href={`/stories/${story.id}/scenario`}
                  aria-label={`Открыть сценарий сюжета ${story.title}`}
                  onClick={(event) => {
                    event.preventDefault();
                    onOpenScenario(story.id);
                  }}
                >
                  {story.title}
                </a>
              </td>
              <td>{story.rubric.name}</td>
              <td>{story.author.display_name}</td>
              <td>{story.situation.label}</td>
              <td>{assigneeSummary(story)}</td>
            </tr>
          ))}
          {items.length === 0 ? (
            <tr><td colSpan={6} className="muted">Сюжеты не найдены</td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
