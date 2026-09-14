import type { ActionRef, StoryListItem, StoryPriority } from "../types";

interface StoriesTableProps {
  items: StoryListItem[];
  onOpenScenario: (storyId: number) => void;
  onRunLifecycle?: (story: StoryListItem, action: ActionRef) => void;
  lifecyclePendingStoryId?: number | null;
  onPriorityChange?: (story: StoryListItem, priority: StoryPriority) => void;
  managementPendingStoryId?: number | null;
}

function AssigneeSummary({ item }: { item: StoryListItem }) {
  const assignments = ["video_editor", "designer"].flatMap((kind) =>
    item.assignments.filter((assignment) => assignment.kind === kind));
  if (!assignments.length) return <span className="muted">Не назначены</span>;
  return <span className="story-assignees">{assignments.map((assignment) => (
    <span key={assignment.kind}>{assignment.kind === "video_editor" ? "Монтажёр" : "Дизайнер"}: {assignment.user.display_name.trim() || assignment.user.username}</span>
  ))}</span>;
}

const registryDateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Moscow",
});

function formatRegistryDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "-" : registryDateFormatter.format(parsed);
}

export default function StoriesTable({
  items,
  onOpenScenario,
  onRunLifecycle,
  lifecyclePendingStoryId,
  onPriorityChange,
  managementPendingStoryId,
}: StoriesTableProps) {
  return (
    <div className="stories-table-wrap">
      <table className="stories-table" aria-label="Общий список сюжетов">
        <thead>
          <tr>
            <th>Приоритет</th>
            <th>Название</th>
            <th>Рубрика</th>
            <th>Автор</th>
            <th>Что происходит</th>
            <th>Исполнители</th>
            <th>Изменён</th>
            <th>Создан</th>
          </tr>
        </thead>
        <tbody>
          {items.map((story) => (
            <tr key={story.id}>
              <td>
                {story.management && onPriorityChange ? (
                  <select
                    className={`story-priority-select story-priority-${story.priority.code}`}
                    aria-label={`Приоритет сюжета ${story.title}`}
                    value={story.priority.code}
                    disabled={managementPendingStoryId != null}
                    onChange={(event) => {
                      onPriorityChange(story, event.target.value as StoryPriority);
                    }}
                  >
                    {story.management.priority_options.map((option) => (
                      <option key={option.code} value={option.code}>{option.label}</option>
                    ))}
                  </select>
                ) : (
                  <span className={`story-priority story-priority-${story.priority.code}`}>
                    {story.priority.label}
                  </span>
                )}
              </td>
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
              <td>
                {story.author.display_name.trim() || story.author.username}
              </td>
              <td>{story.situation.label}</td>
              <td><AssigneeSummary item={story} /></td>
              <td className="story-registry-date">{formatRegistryDateTime(story.updated_at)}</td>
              <td className="story-registry-date">{formatRegistryDateTime(story.created_at)}</td>
            </tr>
          ))}
          {items.length === 0 ? (
            <tr><td colSpan={8} className="muted">Сюжеты не найдены</td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
