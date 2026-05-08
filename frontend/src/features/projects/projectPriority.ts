import { sortableDate } from "../../shared/date";
import type { ProjectListItem, ProjectsView } from "../../shared/types";

export function projectQueuePriority(
  project: ProjectListItem,
  myWorkCountByProjectId: Record<number, number>
): number {
  let score = 0;

  score += (project.my_open_action_comment_count || 0) * 120;
  score += (project.my_in_progress_action_comment_count || 0) * 80;
  score += (project.open_action_comment_count || 0) * 45;
  score += (myWorkCountByProjectId[project.id] || 0) * 35;

  if (!project.current_text_seq) {
    score += 65;
  } else if (!project.current_text_is_latest) {
    score += 100;
  }
  if (!project.latest_text_is_proofread) {
    score += 50;
  }

  if (project.titles_requires_resync) {
    score += 85;
  }
  if (project.edit_requires_resync) {
    score += 75;
  }
  if (project.voiceover_requires_resync) {
    score += 60;
  }

  const statusWeight: Record<string, number> = {
    archived: 0,
    delivered: 0,
    draft: 10,
    in_editing: 35,
    in_proofreading: 35,
    ready: 15,
    reviewed: 25,
  };

  return score + (statusWeight[project.status] || 0);
}

export function sortProjectQueueItems(
  items: ProjectListItem[],
  view: ProjectsView,
  myWorkCountByProjectId: Record<number, number>
): ProjectListItem[] {
  return [...items].sort((left, right) => {
    if (view === "archive") {
      return (
        sortableDate(right.archived_at) - sortableDate(left.archived_at) ||
        sortableDate(right.status_changed_at) - sortableDate(left.status_changed_at) ||
        right.id - left.id
      );
    }

    return (
      projectQueuePriority(right, myWorkCountByProjectId) -
        projectQueuePriority(left, myWorkCountByProjectId) ||
      (right.open_action_comment_count || 0) - (left.open_action_comment_count || 0) ||
      sortableDate(right.status_changed_at) - sortableDate(left.status_changed_at) ||
      sortableDate(right.created_at) - sortableDate(left.created_at) ||
      right.id - left.id
    );
  });
}
