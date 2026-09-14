import type { ActionRef, StoryListItem, StoryPriority } from "../types";
import ActionButton from "./ActionButton";

interface StoriesTableProps {
  items: StoryListItem[];
  onOpenScenario: (storyId: number) => void;
  onRunLifecycle?: (story: StoryListItem, action: ActionRef) => void;
  lifecyclePendingStoryId?: number | null;
  onPriorityChange?: (story: StoryListItem, priority: StoryPriority) => void;
  managementPendingStoryId?: number | null;
  variant?: "active" | "archive";
  onDelete?: (story: StoryListItem) => void;
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
  variant = "active",
  onDelete,
}: StoriesTableProps) {
  const archive = variant === "archive";
  const lifecycleActions = (story: StoryListItem) => onRunLifecycle
    ? (story.lifecycle_actions ?? []).map((action) => (
      <ActionButton key={action.code} className="text-button story-row-action"
        aria-label={`${action.label}: ${story.title}`} disabled={lifecyclePendingStoryId != null}
        onClick={() => onRunLifecycle(story, action)}>
        {lifecyclePendingStoryId === story.id ? "Выполняется…" : action.label}
      </ActionButton>
    )) : null;
  return (
    <div className="stories-table-wrap">
      <table className={`stories-table${archive ? " archive-table" : ""}`} aria-label={archive ? "Архив сюжетов" : "Общий список сюжетов"}>
        <thead>
          <tr>
            {!archive ? <th>Приоритет</th> : null}
            <th>Название</th>
            <th>Рубрика</th>
            <th>Автор</th>
            {!archive ? <th>Что происходит</th> : null}
            <th>Исполнители</th>
            {archive ? <><th>В архиве с</th><th>Действия</th></> : <><th>Изменён</th><th>Создан</th></>}
          </tr>
        </thead>
        <tbody>
          {items.map((story) => (
            <tr key={story.id}>
              {!archive ? <td>
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
              </td> : null}
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
                {!archive ? lifecycleActions(story) : null}
              </td>
              <td>{story.rubric.name}</td>
              <td>
                {story.author.display_name.trim() || story.author.username}
              </td>
              {!archive ? <td>{story.situation.label}</td> : null}
              <td><AssigneeSummary item={story} /></td>
              {archive ? <>
                <td className="story-registry-date">{formatRegistryDateTime(story.archived_at ?? "")}</td>
                <td><div className="archive-row-actions">{lifecycleActions(story)}
                  {story.archived_at && story.delete_action && onDelete ? <ActionButton className="text-button danger"
                    aria-label={`Удалить: ${story.title}`} disabled={lifecyclePendingStoryId != null}
                    onClick={() => onDelete(story)}>Удалить</ActionButton> : null}
                </div></td>
              </> : <>
                <td className="story-registry-date">{formatRegistryDateTime(story.updated_at)}</td>
                <td className="story-registry-date">{formatRegistryDateTime(story.created_at)}</td>
              </>}
            </tr>
          ))}
          {items.length === 0 ? (
            <tr><td colSpan={archive ? 6 : 8} className="muted">Сюжеты не найдены</td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
