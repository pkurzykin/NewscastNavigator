import type { ActionRef, StoryListItem } from "../types";

interface StoriesTableProps {
  items: StoryListItem[];
  onOpenScenario: (storyId: number) => void;
  onRunLifecycle?: (story: StoryListItem, action: ActionRef) => void;
  lifecyclePendingStoryId?: number | null;
}

function assigneeSummary(item: StoryListItem): string {
  if (item.assignments.length === 0) return "Не назначены";
  if (item.assignments.length > 2) return `Исполнителей: ${item.assignments.length}`;
  return item.assignments.map((assignment) => `${assignment.user.position}: ${assignment.user.display_name}`).join(" · ");
}

export default function StoriesTable({
  items,
  onOpenScenario,
  onRunLifecycle,
  lifecyclePendingStoryId,
}: StoriesTableProps) {
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
                {onRunLifecycle ? (story.lifecycle_actions ?? []).map((action) => (
                  <button
                    key={action.code}
                    type="button"
                    className="text-button story-row-action"
                    aria-label={`${action.label}: ${story.title}`}
                    disabled={lifecyclePendingStoryId !== null && lifecyclePendingStoryId !== undefined}
                    onClick={() => onRunLifecycle(story, action)}
                  >
                    {lifecyclePendingStoryId === story.id ? "Восстановление..." : action.label}
                  </button>
                )) : null}
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
