from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, aliased

from app.db.models import Project, User
from app.schemas.project import ProjectListItem
from app.services.structured_fields import parse_int_list_json


def project_text_flags(project: Project) -> dict[str, bool]:
    text_seq = int(project.text_seq or 0)
    current_text_seq = project.current_text_seq
    checked_text_seq = project.checked_text_seq
    proofread_text_seq = project.proofread_text_seq
    current_text_is_latest = (
        current_text_seq is not None
        and text_seq > 0
        and current_text_seq == text_seq
    )
    return {
        "current_text_is_latest": current_text_is_latest,
        "checked_text_is_current": (
            current_text_seq is not None
            and checked_text_seq is not None
            and checked_text_seq == current_text_seq
        ),
        "proofread_text_is_current": (
            current_text_seq is not None
            and proofread_text_seq is not None
            and proofread_text_seq == current_text_seq
        ),
        "latest_text_is_checked": text_seq > 0 and checked_text_seq == text_seq,
        "latest_text_is_proofread": text_seq > 0 and proofread_text_seq == text_seq,
        "titles_text_is_latest": (
            project.titles_text_seq is not None
            and text_seq > 0
            and project.titles_text_seq == text_seq
        ),
        "titles_text_is_current": (
            project.titles_text_seq is not None
            and current_text_seq is not None
            and project.titles_text_seq == current_text_seq
        ),
        "titles_text_is_proofread": (
            project.titles_text_seq is not None
            and proofread_text_seq is not None
            and project.titles_text_seq == proofread_text_seq
        ),
        "titles_requires_resync": (
            project.titles_text_seq is not None
            and text_seq > 0
            and project.titles_text_seq != text_seq
        ),
        "edit_text_is_latest": (
            project.edit_text_seq is not None
            and text_seq > 0
            and project.edit_text_seq == text_seq
        ),
        "edit_text_is_current": (
            project.edit_text_seq is not None
            and current_text_seq is not None
            and project.edit_text_seq == current_text_seq
        ),
        "edit_requires_resync": (
            project.edit_text_seq is not None
            and current_text_seq is not None
            and project.edit_text_seq != current_text_seq
        ),
        "voiceover_text_is_latest": (
            project.voiceover_text_seq is not None
            and text_seq > 0
            and project.voiceover_text_seq == text_seq
        ),
        "voiceover_text_is_current": (
            project.voiceover_text_seq is not None
            and current_text_seq is not None
            and project.voiceover_text_seq == current_text_seq
        ),
        "voiceover_text_is_proofread": (
            project.voiceover_text_seq is not None
            and proofread_text_seq is not None
            and project.voiceover_text_seq == proofread_text_seq
        ),
        "voiceover_requires_resync": (
            project.voiceover_text_seq is not None
            and text_seq > 0
            and project.voiceover_text_seq != text_seq
        ),
    }


def project_to_item(
    project: Project,
    *,
    author_username: str | None = None,
    executor_username: str | None = None,
    proofreader_username: str | None = None,
    archived_by_username: str | None = None,
    open_action_comment_count: int = 0,
    open_text_action_comment_count: int = 0,
    open_edit_action_comment_count: int = 0,
    open_titles_action_comment_count: int = 0,
    open_voiceover_action_comment_count: int = 0,
    my_open_action_comment_count: int = 0,
    my_open_text_action_comment_count: int = 0,
    my_open_edit_action_comment_count: int = 0,
    my_open_titles_action_comment_count: int = 0,
    my_open_voiceover_action_comment_count: int = 0,
) -> ProjectListItem:
    text_flags = project_text_flags(project)
    return ProjectListItem(
        id=project.id,
        title=project.title,
        status=project.status,
        rubric=project.rubric,
        planned_duration=project.planned_duration,
        source_project_id=project.source_project_id,
        author_user_id=project.author_user_id,
        author_username=author_username,
        executor_user_id=project.executor_user_id,
        executor_user_ids=parse_int_list_json(
            project.executor_user_ids_json,
            fallback=project.executor_user_id,
        ),
        executor_username=executor_username,
        proofreader_user_id=project.proofreader_user_id,
        proofreader_username=proofreader_username,
        titles_assignee_user_id=project.titles_assignee_user_id,
        edit_assignee_user_id=project.edit_assignee_user_id,
        open_action_comment_count=int(open_action_comment_count or 0),
        open_text_action_comment_count=int(open_text_action_comment_count or 0),
        open_edit_action_comment_count=int(open_edit_action_comment_count or 0),
        open_titles_action_comment_count=int(open_titles_action_comment_count or 0),
        open_voiceover_action_comment_count=int(open_voiceover_action_comment_count or 0),
        my_open_action_comment_count=int(my_open_action_comment_count or 0),
        my_open_text_action_comment_count=int(my_open_text_action_comment_count or 0),
        my_open_edit_action_comment_count=int(my_open_edit_action_comment_count or 0),
        my_open_titles_action_comment_count=int(my_open_titles_action_comment_count or 0),
        my_open_voiceover_action_comment_count=int(my_open_voiceover_action_comment_count or 0),
        text_seq=int(project.text_seq or 0),
        current_text_seq=project.current_text_seq,
        current_text_set_at=project.current_text_set_at,
        current_text_set_by_user_id=project.current_text_set_by,
        checked_text_seq=project.checked_text_seq,
        checked_at=project.checked_at,
        checked_by_user_id=project.checked_by,
        proofread_text_seq=project.proofread_text_seq,
        proofread_at=project.proofread_at,
        proofread_by_user_id=project.proofread_by,
        current_text_is_latest=text_flags["current_text_is_latest"],
        checked_text_is_current=text_flags["checked_text_is_current"],
        proofread_text_is_current=text_flags["proofread_text_is_current"],
        latest_text_is_checked=text_flags["latest_text_is_checked"],
        latest_text_is_proofread=text_flags["latest_text_is_proofread"],
        titles_status=project.titles_status or "not_started",
        titles_text_seq=project.titles_text_seq,
        titles_updated_at=project.titles_updated_at,
        titles_updated_by_user_id=project.titles_updated_by,
        titles_text_is_latest=text_flags["titles_text_is_latest"],
        titles_text_is_current=text_flags["titles_text_is_current"],
        titles_text_is_proofread=text_flags["titles_text_is_proofread"],
        titles_requires_resync=text_flags["titles_requires_resync"],
        edit_status=project.edit_status or "not_started",
        edit_text_seq=project.edit_text_seq,
        edit_updated_at=project.edit_updated_at,
        edit_updated_by_user_id=project.edit_updated_by,
        edit_text_is_current=text_flags["edit_text_is_current"],
        edit_text_is_latest=text_flags["edit_text_is_latest"],
        edit_requires_resync=text_flags["edit_requires_resync"],
        voiceover_status=project.voiceover_status or "not_started",
        voiceover_text_seq=project.voiceover_text_seq,
        voiceover_updated_at=project.voiceover_updated_at,
        voiceover_updated_by_user_id=project.voiceover_updated_by,
        voiceover_text_is_latest=text_flags["voiceover_text_is_latest"],
        voiceover_text_is_current=text_flags["voiceover_text_is_current"],
        voiceover_text_is_proofread=text_flags["voiceover_text_is_proofread"],
        voiceover_requires_resync=text_flags["voiceover_requires_resync"],
        final_review_status=project.final_review_status or "not_started",
        final_review_updated_at=project.final_review_updated_at,
        final_review_updated_by_user_id=project.final_review_updated_by,
        archived_at=project.archived_at,
        archived_by_user_id=project.archived_by,
        archived_by_username=archived_by_username,
        status_changed_at=project.status_changed_at,
        status_changed_by_user_id=project.status_changed_by,
        created_at=project.created_at,
    )


def build_project_row_stmt() -> tuple:
    author_user = aliased(User)
    executor_user = aliased(User)
    proofreader_user = aliased(User)
    archived_by_user = aliased(User)
    stmt = (
        select(
            Project,
            author_user.username,
            executor_user.username,
            proofreader_user.username,
            archived_by_user.username,
        )
        .outerjoin(author_user, author_user.id == Project.author_user_id)
        .outerjoin(executor_user, executor_user.id == Project.executor_user_id)
        .outerjoin(proofreader_user, proofreader_user.id == Project.proofreader_user_id)
        .outerjoin(archived_by_user, archived_by_user.id == Project.archived_by)
    )
    return stmt, author_user, executor_user, proofreader_user, archived_by_user


def fetch_project_row(
    db: Session,
    project_id: int,
) -> tuple[Project, str | None, str | None, str | None, str | None]:
    stmt, _author_user, _executor_user, _proofreader_user, _archived_by_user = build_project_row_stmt()
    row = db.execute(stmt.where(Project.id == project_id)).first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Проект не найден",
        )
    return row[0], row[1], row[2], row[3], row[4]
