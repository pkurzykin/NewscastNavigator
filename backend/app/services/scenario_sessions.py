from __future__ import annotations

from datetime import UTC, datetime, timedelta
from hashlib import sha256
from secrets import token_urlsafe

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import Scenario, ScenarioEditSession, User
from app.services.scenario_history import ensure_current_revision_snapshot, finalize_edit_session


def _error(code: str, message: str, http_status: int = status.HTTP_409_CONFLICT) -> HTTPException:
    return HTTPException(status_code=http_status, detail={"code": code, "message": message})


def _now() -> datetime:
    return datetime.now(UTC)


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _token_hash(token: str) -> str:
    return sha256(token.encode("utf-8")).hexdigest()


def _expires_at(now: datetime) -> datetime:
    return now + timedelta(seconds=get_settings().scenario_lease_ttl_seconds)


def scenario_for_update_statement(scenario_id: int):
    return select(Scenario).where(Scenario.id == scenario_id).with_for_update()


def edit_session_for_update_statement(edit_session_id: int):
    return select(ScenarioEditSession).where(ScenarioEditSession.id == edit_session_id).with_for_update()


def expire_current_lease(db: Session, *, scenario_id: int, now: datetime | None = None) -> bool:
    current_time = now or _now()
    db.scalar(scenario_for_update_statement(scenario_id))
    active = db.scalar(
        select(ScenarioEditSession)
        .where(
            ScenarioEditSession.scenario_id == scenario_id,
            ScenarioEditSession.ended_at.is_(None),
            ScenarioEditSession.expires_at <= current_time,
        )
        .with_for_update()
    )
    if active is not None:
        finalize_edit_session(db, session=active, ended_at=current_time)
        return True
    return False


def acquire_lease(db: Session, *, scenario: Scenario, actor: User) -> tuple[ScenarioEditSession, str]:
    now = _now()
    expire_current_lease(db, scenario_id=scenario.id, now=now)
    current = db.scalar(
        select(ScenarioEditSession)
        .where(ScenarioEditSession.scenario_id == scenario.id, ScenarioEditSession.ended_at.is_(None))
        .with_for_update()
    )
    if current is not None:
        raise _error("SCENARIO_LEASE_HELD", "Сценарий уже редактирует другой пользователь")

    ensure_current_revision_snapshot(db, scenario=scenario, actor=actor)
    token = token_urlsafe(32)
    session = ScenarioEditSession(
        scenario_id=scenario.id,
        actor_user_id=actor.id,
        lease_token_hash=_token_hash(token),
        base_revision_no=scenario.revision_no,
        latest_revision_no=scenario.revision_no,
        started_at=now,
        last_activity_at=now,
        expires_at=_expires_at(now),
    )
    db.add(session)
    db.flush()
    return session, token


def require_owned_lease(
    db: Session,
    *,
    scenario: Scenario,
    actor: User,
    edit_session_id: int,
    lease_token: str,
) -> ScenarioEditSession:
    session = db.scalar(edit_session_for_update_statement(edit_session_id))
    if session is None or session.scenario_id != scenario.id or session.actor_user_id != actor.id:
        raise _error("SCENARIO_LEASE_INVALID", "Lease сценария недействительна")
    now = _now()
    if session.ended_at is not None or _as_utc(session.expires_at) <= now:
        if session.ended_at is None:
            finalize_edit_session(db, session=session, ended_at=now)
            db.commit()
        raise _error("SCENARIO_LEASE_EXPIRED", "Lease сценария истекла")
    if session.lease_token_hash != _token_hash(lease_token):
        raise _error("SCENARIO_LEASE_INVALID", "Lease сценария недействительна")
    return session


def heartbeat_lease(
    db: Session,
    *,
    scenario: Scenario,
    actor: User,
    edit_session_id: int,
    lease_token: str,
) -> ScenarioEditSession:
    session = require_owned_lease(
        db,
        scenario=scenario,
        actor=actor,
        edit_session_id=edit_session_id,
        lease_token=lease_token,
    )
    now = _now()
    session.last_activity_at = now
    session.expires_at = _expires_at(now)
    db.commit()
    db.refresh(session)
    return session


def release_lease(
    db: Session,
    *,
    scenario: Scenario,
    actor: User,
    edit_session_id: int,
    lease_token: str,
) -> None:
    session = require_owned_lease(
        db,
        scenario=scenario,
        actor=actor,
        edit_session_id=edit_session_id,
        lease_token=lease_token,
    )
    finalize_edit_session(db, session=session, ended_at=_now())
    db.commit()
