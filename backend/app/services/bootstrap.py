from __future__ import annotations

from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.models import Project, ProjectComment, ProjectEvent, ScriptElement, User
from app.db.session import SessionLocal
from app.services.project_events import log_project_event, utcnow
from app.services.structured_fields import build_initial_rich_text_json


def _seed_users(db: Session) -> dict[str, User]:
    required_users = [
        ("admin", "admin123", "admin"),
        ("editor", "editor123", "editor"),
        ("author", "author123", "author"),
        ("proofreader", "proof123", "proofreader"),
    ]
    existing = {
        row.username: row
        for row in db.execute(select(User)).scalars().all()
    }

    created: list[User] = []
    for username, password, role in required_users:
        if username in existing:
            continue
        item = User(
            username=username,
            password_hash=hash_password(password),
            role=role,
            is_active=True,
        )
        db.add(item)
        created.append(item)

    if created:
        db.flush()
        for item in created:
            existing[item.username] = item

    return existing


def _seed_projects(db: Session, users: dict[str, User]) -> None:
    projects_count = db.scalar(select(func.count(Project.id))) or 0
    if projects_count > 0:
        return

    now = utcnow()
    author_user = users.get("author")
    editor_user = users.get("editor")
    proofreader_user = users.get("proofreader")

    demo_projects = [
        Project(
            title="Преподаватели вузов на объектах АО Транснефть - Урал",
            status="draft",
            rubric="Новости",
            planned_duration="02:30",
            project_note="Демо-комментарий проекта: проверить формулировки и таймкоды перед выпуском.",
            author_user_id=author_user.id if author_user else None,
            executor_user_id=editor_user.id if editor_user else None,
            proofreader_user_id=proofreader_user.id if proofreader_user else None,
            status_changed_at=now,
            status_changed_by=author_user.id if author_user else None,
        ),
        Project(
            title="Специальный репортаж о производственной практике",
            status="reviewed",
            rubric="Специальный репортаж",
            planned_duration="04:00",
            project_note="Нужна финальная редактура текста.",
            author_user_id=editor_user.id if editor_user else None,
            executor_user_id=editor_user.id if editor_user else None,
            proofreader_user_id=proofreader_user.id if proofreader_user else None,
            status_changed_at=now,
            status_changed_by=editor_user.id if editor_user else None,
        ),
        Project(
            title="Сюжет в архиве (демо)",
            status="archived",
            rubric="Новости",
            planned_duration="01:50",
            project_note="Архивная версия для примера.",
            author_user_id=author_user.id if author_user else None,
            executor_user_id=editor_user.id if editor_user else None,
            proofreader_user_id=proofreader_user.id if proofreader_user else None,
            archived_at=now,
            archived_by=editor_user.id if editor_user else None,
            status_changed_at=now,
            status_changed_by=editor_user.id if editor_user else None,
        ),
    ]
    db.add_all(demo_projects)
    db.flush()


def _seed_project_events(db: Session, users: dict[str, User]) -> None:
    events_count = db.scalar(select(func.count(ProjectEvent.id))) or 0
    if events_count > 0:
        return

    projects = db.execute(select(Project).order_by(Project.id.asc())).scalars().all()
    if not projects:
        return

    author_user = users.get("author")
    editor_user = users.get("editor")

    for project in projects:
        actor_id = project.author_user_id or (author_user.id if author_user else None)
        log_project_event(
            db,
            project_id=project.id,
            event_type="project_created",
            actor_user_id=actor_id,
        )
        if project.status == "reviewed" and editor_user is not None:
            log_project_event(
                db,
                project_id=project.id,
                event_type="status_changed",
                actor_user_id=editor_user.id,
                old_value="draft",
                new_value="reviewed",
            )
        if project.status == "archived" and editor_user is not None:
            log_project_event(
                db,
                project_id=project.id,
                event_type="status_changed",
                actor_user_id=editor_user.id,
                old_value="ready",
                new_value="archived",
            )
            log_project_event(
                db,
                project_id=project.id,
                event_type="project_archived",
                actor_user_id=editor_user.id,
            )


def _seed_script_elements(db: Session) -> None:
    elements_count = db.scalar(select(func.count(ScriptElement.id))) or 0
    if elements_count > 0:
        return

    target_project = db.execute(
        select(Project)
        .where(Project.status != "archived")
        .order_by(Project.created_at.asc(), Project.id.asc())
        .limit(1)
    ).scalar_one_or_none()
    if target_project is None:
        return

    demo_rows = [
        ScriptElement(
            project_id=target_project.id,
            order_index=1,
            block_type="podvodka",
            text="Лекция под открытым небом: преподаватели вузов посетили объекты компании.",
            speaker_text="",
            file_name="",
            tc_in="",
            tc_out="",
            additional_comment="",
            rich_text_json=build_initial_rich_text_json(
                block_type="podvodka",
                text="Лекция под открытым небом: преподаватели вузов посетили объекты компании.",
                speaker_text="",
                structured_data={},
            ),
        ),
        ScriptElement(
            project_id=target_project.id,
            order_index=2,
            block_type="zk",
            text="Они смогли увидеть действующие производственные процессы и задать вопросы специалистам.",
            speaker_text="",
            file_name="",
            tc_in="00:10",
            tc_out="00:26",
            additional_comment="",
            rich_text_json=build_initial_rich_text_json(
                block_type="zk",
                text="Они смогли увидеть действующие производственные процессы и задать вопросы специалистам.",
                speaker_text="",
                structured_data={},
            ),
        ),
        ScriptElement(
            project_id=target_project.id,
            order_index=3,
            block_type="snh",
            text="Я считаю этот визит полезным для будущих специалистов.",
            speaker_text="Эдуард Еникеев\nНачальник ЛПДС",
            file_name="SN347",
            tc_in="00:38",
            tc_out="00:56",
            additional_comment="",
            rich_text_json=build_initial_rich_text_json(
                block_type="snh",
                text="Я считаю этот визит полезным для будущих специалистов.",
                speaker_text="Эдуард Еникеев\nНачальник ЛПДС",
                structured_data={},
            ),
        ),
    ]
    db.add_all(demo_rows)


def _seed_project_comments(db: Session, users: dict[str, User]) -> None:
    comments_count = db.scalar(select(func.count(ProjectComment.id))) or 0
    if comments_count > 0:
        return

    target_project = db.execute(
        select(Project)
        .where(Project.status != "archived")
        .order_by(Project.created_at.asc(), Project.id.asc())
        .limit(1)
    ).scalar_one_or_none()
    if target_project is None:
        return

    author_user = users.get("author")
    if author_user is None:
        return

    db.add(
        ProjectComment(
            project_id=target_project.id,
            user_id=author_user.id,
            text="Добавлен первичный комментарий к проекту (демо).",
        )
    )


def _ensure_runtime_path(raw_path: str) -> None:
    path = Path(raw_path).expanduser()
    if not path.is_absolute():
        path = Path.cwd() / path
    path.mkdir(parents=True, exist_ok=True)


def ensure_runtime_paths() -> None:
    settings = get_settings()
    _ensure_runtime_path(settings.storage_root)
    _ensure_runtime_path(settings.export_root)

def seed_demo_data(force: bool = False) -> None:
    settings = get_settings()
    ensure_runtime_paths()

    if not force and not settings.seed_demo_data:
        return

    with SessionLocal() as db:
        users = _seed_users(db)
        _seed_projects(db, users)
        db.flush()
        _seed_project_events(db, users)
        _seed_script_elements(db)
        _seed_project_comments(db, users)
        db.commit()
