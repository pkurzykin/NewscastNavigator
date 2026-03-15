from __future__ import annotations

from fastapi import HTTPException, status

from app.db.models import Project, User
from app.schemas.project import PROJECT_STATUS_VALUES


PROJECT_STATUS_SET = set(PROJECT_STATUS_VALUES)
ACTIVE_PROJECT_STATUSES = PROJECT_STATUS_SET - {"archived"}
CONTENT_EDITOR_BYPASS_ROLES = {"admin", "editor"}
CONTENT_EDITOR_ROLES = {"author", "proofreader"}


def normalize_project_status(raw_status: str | None) -> str:
    value = (raw_status or "").strip().lower()
    return value if value in PROJECT_STATUS_SET else "draft"


def is_archived_project(project_or_status: Project | str | None) -> bool:
    if isinstance(project_or_status, Project):
        raw_status = project_or_status.status
    else:
        raw_status = project_or_status
    return normalize_project_status(raw_status) == "archived"


def can_edit_project_content(user_role: str, project_status: str | None) -> bool:
    normalized_role = (user_role or "").strip().lower()
    normalized_status = normalize_project_status(project_status)

    if normalized_status == "archived":
        return False
    if normalized_role in CONTENT_EDITOR_BYPASS_ROLES:
        return True
    if normalized_status == "in_proofreading":
        return normalized_role == "proofreader"
    return normalized_role in CONTENT_EDITOR_ROLES


def ensure_can_edit_project_content(current_user: User, project: Project) -> None:
    normalized_status = normalize_project_status(project.status)
    if normalized_status == "archived":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Архивный проект нельзя редактировать. Сначала верните его в MAIN.",
        )

    if can_edit_project_content(current_user.role, normalized_status):
        return

    if normalized_status == "in_proofreading":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="На этапе корректуры редактирование доступно только корректору, редактору и администратору.",
        )

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Недостаточно прав для редактирования проекта.",
    )
