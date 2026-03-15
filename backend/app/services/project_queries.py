from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, aliased

from app.db.models import Project, User
from app.schemas.project import ProjectListItem


def project_to_item(
    project: Project,
    *,
    author_username: str | None = None,
    executor_username: str | None = None,
    proofreader_username: str | None = None,
    archived_by_username: str | None = None,
) -> ProjectListItem:
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
        executor_username=executor_username,
        proofreader_user_id=project.proofreader_user_id,
        proofreader_username=proofreader_username,
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
