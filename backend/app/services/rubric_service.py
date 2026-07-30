from __future__ import annotations

from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Rubric, User
from app.schemas.common import CommandAck, ResourceRef
from app.services.permissions import is_leadership


def _error(code: str, message: str, http_status: int) -> HTTPException:
    return HTTPException(
        status_code=http_status,
        detail={"code": code, "message": message},
    )


def _require_leadership(actor: User) -> None:
    if not actor.is_active or not is_leadership(actor):
        raise _error("FORBIDDEN", "Недостаточно прав", status.HTTP_403_FORBIDDEN)


def _normalize_name(name: str) -> str:
    normalized = " ".join(name.split())
    if not normalized:
        raise _error(
            "VALIDATION_ERROR",
            "Название рубрики не может быть пустым",
            status.HTTP_422_UNPROCESSABLE_CONTENT,
        )
    return normalized


def _name_is_taken(
    db: Session,
    *,
    normalized_name: str,
    except_id: int | None = None,
) -> bool:
    rubrics = db.execute(select(Rubric)).scalars().all()
    normalized_key = normalized_name.casefold()
    return any(
        rubric.id != except_id and rubric.name.casefold() == normalized_key
        for rubric in rubrics
    )


def create_rubric(
    db: Session,
    *,
    actor: User,
    name: str,
) -> CommandAck:
    _require_leadership(actor)
    normalized_name = _normalize_name(name)
    if _name_is_taken(db, normalized_name=normalized_name):
        raise _error(
            "RUBRIC_NAME_TAKEN",
            "Рубрика с таким названием уже существует",
            status.HTTP_409_CONFLICT,
        )
    now = datetime.now(UTC)
    rubric = Rubric(
        name=normalized_name,
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    db.add(rubric)
    db.flush()
    db.commit()
    return CommandAck(
        changed_at=now,
        resource=ResourceRef(type="rubric", id=rubric.id),
    )


def update_rubric(
    db: Session,
    *,
    rubric_id: int,
    actor: User,
    name: str | None,
    is_active: bool | None,
) -> CommandAck:
    _require_leadership(actor)
    if name is None and is_active is None:
        raise _error(
            "EMPTY_PATCH",
            "Нужно указать хотя бы одно изменение",
            status.HTTP_400_BAD_REQUEST,
        )
    rubric = db.get(Rubric, rubric_id)
    if rubric is None:
        raise _error(
            "RUBRIC_NOT_FOUND",
            "Рубрика не найдена",
            status.HTTP_404_NOT_FOUND,
        )
    normalized_name = _normalize_name(name) if name is not None else None
    if (
        normalized_name is not None
        and _name_is_taken(
            db,
            normalized_name=normalized_name,
            except_id=rubric.id,
        )
    ):
        raise _error(
            "RUBRIC_NAME_TAKEN",
            "Рубрика с таким названием уже существует",
            status.HTTP_409_CONFLICT,
        )
    changed = False
    if normalized_name is not None and normalized_name != rubric.name:
        rubric.name = normalized_name
        changed = True
    if is_active is not None and is_active != rubric.is_active:
        rubric.is_active = is_active
        changed = True
    if not changed:
        return CommandAck(
            changed_at=rubric.updated_at,
            resource=ResourceRef(type="rubric", id=rubric.id),
        )
    now = datetime.now(UTC)
    rubric.updated_at = now
    db.commit()
    return CommandAck(
        changed_at=now,
        resource=ResourceRef(type="rubric", id=rubric.id),
    )
