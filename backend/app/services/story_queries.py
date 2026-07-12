from __future__ import annotations

from datetime import datetime

from sqlalchemy import Select, case, func, or_, select
from sqlalchemy.orm import Session

from app.db.models import ExternalApprovalCycle, Rubric, Story, StoryAssignment, StoryProductionState, User


PRIORITY_LABELS = {"standard": "Обычный", "high": "Высокий"}
SITUATION_LABELS = {"active": "В работе", "archive": "В архиве"}


def _user_ref(user: User) -> dict[str, object]:
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "position": user.position,
        "function_codes": user.function_codes,
    }


def build_story_list_read_model(
    *,
    story_id: int,
    title: str,
    priority: str,
    rubric: dict[str, object],
    author: dict[str, object],
    created_at: datetime | str,
    archived_at: datetime | str | None,
    assignments: list[dict[str, object]],
) -> dict[str, object]:
    situation_code = "archive" if archived_at is not None else "active"
    return {
        "id": story_id,
        "title": title,
        "priority": {"code": priority, "label": PRIORITY_LABELS[priority]},
        "rubric": rubric,
        "author": author,
        "situation": {"code": situation_code, "label": SITUATION_LABELS[situation_code]},
        "assignments": assignments,
        "created_at": created_at,
        "archived_at": archived_at,
    }


def _story_filters(query, current_user: User) -> Select[tuple[Story]]:
    statement = select(Story)
    statement = statement.where(Story.archived_at.is_(None) if query.scope == "active" else Story.archived_at.is_not(None))
    if query.priority is not None:
        statement = statement.where(Story.priority == query.priority)
    if query.rubric_id is not None:
        statement = statement.where(Story.rubric_id == query.rubric_id)
    if query.mine:
        statement = statement.where(
            or_(
                Story.author_user_id == current_user.id,
                Story.id.in_(select(StoryAssignment.story_id).where(StoryAssignment.user_id == current_user.id)),
            )
        )
    if query.area == "video":
        statement = statement.where(
            or_(
                Story.id.in_(select(StoryAssignment.story_id).where(StoryAssignment.kind == "video_editor")),
                Story.id.in_(select(StoryProductionState.story_id).where(StoryProductionState.video_started_at.is_not(None))),
            )
        )
    if query.area == "titles":
        statement = statement.where(
            or_(
                Story.id.in_(select(StoryAssignment.story_id).where(StoryAssignment.kind == "designer")),
                Story.id.in_(select(StoryProductionState.story_id).where(StoryProductionState.titles_started_at.is_not(None))),
            )
        )
    if query.area == "voiceover":
        statement = statement.where(
            Story.id.in_(select(StoryProductionState.story_id).where(StoryProductionState.voiceover_ready_at.is_not(None)))
        )
    if query.area == "external":
        statement = statement.where(Story.id.in_(select(ExternalApprovalCycle.story_id)))
    if query.search:
        needle = f"%{query.search.strip()}%"
        statement = statement.join(Rubric, Rubric.id == Story.rubric_id).join(User, User.id == Story.author_user_id).where(
            or_(Story.title.ilike(needle), Rubric.name.ilike(needle), User.display_name.ilike(needle))
        )
    return statement


def list_story_read_models(db: Session, query, current_user: User) -> tuple[list[dict[str, object]], int]:
    statement = _story_filters(query, current_user)
    total = db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    priority_order = case((Story.priority == "high", 0), else_=1)
    stories = db.execute(
        statement.order_by(priority_order, Story.created_at.desc(), Story.id.desc()).limit(query.limit)
    ).scalars().all()
    if not stories:
        return [], total
    user_ids = {story.author_user_id for story in stories}
    assignments = db.execute(select(StoryAssignment).where(StoryAssignment.story_id.in_([story.id for story in stories]))).scalars().all()
    user_ids.update(assignment.user_id for assignment in assignments)
    users = {user.id: user for user in db.execute(select(User).where(User.id.in_(user_ids))).scalars().all()}
    rubrics = {rubric.id: rubric for rubric in db.execute(select(Rubric).where(Rubric.id.in_([story.rubric_id for story in stories]))).scalars().all()}
    assignments_by_story: dict[int, list[dict[str, object]]] = {story.id: [] for story in stories}
    for assignment in assignments:
        assignments_by_story[assignment.story_id].append({"kind": assignment.kind, "user": _user_ref(users[assignment.user_id])})
    return [
        build_story_list_read_model(
            story_id=story.id,
            title=story.title,
            priority=story.priority,
            rubric={"id": rubrics[story.rubric_id].id, "name": rubrics[story.rubric_id].name},
            author=_user_ref(users[story.author_user_id]),
            created_at=story.created_at,
            archived_at=story.archived_at,
            assignments=assignments_by_story[story.id],
        )
        for story in stories
    ], total


def get_story_read_model(db: Session, story_id: int) -> dict[str, object] | None:
    story = db.get(Story, story_id)
    if story is None:
        return None
    author = db.get(User, story.author_user_id)
    rubric = db.get(Rubric, story.rubric_id)
    if author is None or rubric is None:
        return None
    assignments = db.execute(
        select(StoryAssignment).where(StoryAssignment.story_id == story.id)
    ).scalars().all()
    assignees = {assignment.user_id: db.get(User, assignment.user_id) for assignment in assignments}
    return build_story_list_read_model(
        story_id=story.id,
        title=story.title,
        priority=story.priority,
        rubric={"id": rubric.id, "name": rubric.name},
        author=_user_ref(author),
        created_at=story.created_at,
        archived_at=story.archived_at,
        assignments=[
            {"kind": assignment.kind, "user": _user_ref(assignees[assignment.user_id])}
            for assignment in assignments
            if assignees[assignment.user_id] is not None
        ],
    )
