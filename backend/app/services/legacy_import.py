from __future__ import annotations

import json
import shutil
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import Engine, func, select, text
from sqlalchemy.orm import Session, sessionmaker

from app.db.models import Project, ProjectComment, ProjectEvent, ProjectFile, ScriptElement, User
from app.services.project_access import normalize_project_status


TARGET_TABLES = (
    ProjectEvent,
    ProjectFile,
    ProjectComment,
    ScriptElement,
    Project,
    User,
)


@dataclass(slots=True)
class LegacyImportResult:
    users: int = 0
    projects: int = 0
    elements: int = 0
    comments: int = 0
    files: int = 0
    events: int = 0
    copied_files: int = 0


def import_legacy_sqlite(
    *,
    legacy_db_path: Path,
    target_session_factory: sessionmaker[Session],
    target_engine: Engine,
    target_storage_root: Path,
    legacy_storage_root: Path | None = None,
    copy_files: bool = True,
    require_empty_target: bool = True,
) -> LegacyImportResult:
    legacy_db_path = legacy_db_path.expanduser().resolve()
    if not legacy_db_path.exists():
        raise FileNotFoundError(f"Legacy SQLite DB not found: {legacy_db_path}")

    target_storage_root = target_storage_root.expanduser().resolve()
    target_storage_root.mkdir(parents=True, exist_ok=True)

    if legacy_storage_root is not None:
        legacy_storage_root = legacy_storage_root.expanduser().resolve()

    with sqlite3.connect(legacy_db_path) as source_conn, target_session_factory() as db:
        source_conn.row_factory = sqlite3.Row

        if require_empty_target:
            _ensure_empty_target(db)

        result = LegacyImportResult()
        available_columns = _load_table_columns(source_conn)

        users = _import_users(source_conn, db)
        result.users = len(users)

        projects = _import_projects(
            source_conn,
            db,
            available_columns=available_columns,
            existing_user_ids=set(users),
        )
        result.projects = len(projects)

        elements = _import_script_elements(source_conn, db, existing_project_ids=set(projects))
        result.elements = len(elements)

        comments = _import_comments(
            source_conn,
            db,
            available_columns=available_columns,
            element_project_map=elements,
            existing_project_ids=set(projects),
            existing_user_ids=set(users),
        )
        result.comments = comments

        files, copied_files = _import_project_files(
            source_conn,
            db,
            existing_project_ids=set(projects),
            existing_user_ids=set(users),
            target_storage_root=target_storage_root,
            legacy_storage_root=legacy_storage_root,
            copy_files=copy_files,
        )
        result.files = files
        result.copied_files = copied_files

        result.events = _import_project_events(
            source_conn,
            db,
            existing_project_ids=set(projects),
            existing_user_ids=set(users),
        )

        db.commit()

    _sync_sequences(target_engine)
    return result


def _ensure_empty_target(db: Session) -> None:
    non_empty_tables: list[str] = []
    for model in TARGET_TABLES:
        count = db.scalar(select(func.count()).select_from(model)) or 0
        if count > 0:
            non_empty_tables.append(f"{model.__tablename__}={count}")
    if non_empty_tables:
        joined = ", ".join(non_empty_tables)
        raise RuntimeError(f"Target database is not empty: {joined}")


def _load_table_columns(conn: sqlite3.Connection) -> dict[str, set[str]]:
    table_names = [
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall()
    ]
    result: dict[str, set[str]] = {}
    for table_name in table_names:
        columns = {
            row[1]
            for row in conn.execute(f"PRAGMA table_info({table_name})").fetchall()
        }
        result[table_name] = columns
    return result


def _parse_legacy_dt(value: object) -> datetime | None:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _legacy_hash_to_text(value: object) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="ignore")
    return str(value or "").strip()


def _normalize_project_status_with_archive(row: sqlite3.Row) -> str:
    if int(row["is_archived"] or 0) == 1:
        return "archived"
    return normalize_project_status(row["status"])


def _clean_optional_text(value: object) -> str | None:
    text_value = str(value or "").strip()
    return text_value or None


def _build_project_note(row: sqlite3.Row) -> str:
    notes: list[str] = []
    topic = str(row["topic"] or "").strip() if "topic" in row.keys() else ""
    if topic:
        notes.append(f"Legacy topic: {topic}")
    return "\n\n".join(notes).strip()


def _resolve_project_assignment(row: sqlite3.Row, field_name: str, fallback_name: str | None = None) -> int | None:
    if field_name in row.keys() and row[field_name] is not None:
        return int(row[field_name])
    if fallback_name and fallback_name in row.keys() and row[fallback_name] is not None:
        return int(row[fallback_name])
    return None


def _import_users(conn: sqlite3.Connection, db: Session) -> dict[int, User]:
    result: dict[int, User] = {}
    rows = conn.execute(
        "SELECT id, username, password_hash, role FROM users ORDER BY id"
    ).fetchall()
    for row in rows:
        user = User(
            id=int(row["id"]),
            username=str(row["username"] or "").strip(),
            password_hash=_legacy_hash_to_text(row["password_hash"]),
            role=str(row["role"] or "author").strip() or "author",
            is_active=True,
        )
        db.add(user)
        result[user.id] = user
    db.flush()
    return result


def _import_projects(
    conn: sqlite3.Connection,
    db: Session,
    *,
    available_columns: dict[str, set[str]],
    existing_user_ids: set[int],
) -> dict[int, Project]:
    project_columns = available_columns.get("projects", set())
    rows = conn.execute("SELECT * FROM projects ORDER BY id").fetchall()
    result: dict[int, Project] = {}
    for row in rows:
        author_user_id = _resolve_project_assignment(row, "author_user_id", "author_id")
        executor_user_id = _resolve_project_assignment(row, "executor_user_id")
        proofreader_user_id = _resolve_project_assignment(row, "proofreader_user_id")
        archived_by = _resolve_project_assignment(row, "archived_by")
        status_changed_by = _resolve_project_assignment(row, "status_changed_by")

        created_at = _parse_legacy_dt(row["created_at"])
        archived_at = _parse_legacy_dt(row["archived_at"]) if "archived_at" in project_columns else None
        status_changed_at = (
            _parse_legacy_dt(row["status_changed_at"])
            if "status_changed_at" in project_columns
            else None
        )
        normalized_status = _normalize_project_status_with_archive(row)
        if normalized_status == "archived" and archived_at is None:
            archived_at = status_changed_at or created_at
        if status_changed_at is None:
            status_changed_at = archived_at or created_at

        project = Project(
            id=int(row["id"]),
            title=str(row["title"] or "").strip() or f"Legacy Project #{row['id']}",
            status=normalized_status,
            rubric=_clean_optional_text(row["rubric"]) if "rubric" in project_columns else None,
            planned_duration=_clean_optional_text(row["planned_duration"]) if "planned_duration" in project_columns else None,
            source_project_id=(
                int(row["source_project_id"])
                if "source_project_id" in project_columns and row["source_project_id"] is not None
                else None
            ),
            project_file_root=_clean_optional_text(row["file_root"]) if "file_root" in project_columns else None,
            project_note=_build_project_note(row),
            author_user_id=author_user_id if author_user_id in existing_user_ids else None,
            executor_user_id=executor_user_id if executor_user_id in existing_user_ids else None,
            proofreader_user_id=proofreader_user_id if proofreader_user_id in existing_user_ids else None,
            archived_at=archived_at,
            archived_by=archived_by if archived_by in existing_user_ids else None,
            status_changed_at=status_changed_at,
            status_changed_by=status_changed_by if status_changed_by in existing_user_ids else None,
            created_at=created_at,
        )
        db.add(project)
        result[project.id] = project
    db.flush()
    return result


def _import_script_elements(
    conn: sqlite3.Connection,
    db: Session,
    *,
    existing_project_ids: set[int],
) -> dict[int, int]:
    rows = conn.execute("SELECT * FROM script_elements ORDER BY id").fetchall()
    element_project_map: dict[int, int] = {}
    for row in rows:
        project_id = int(row["project_id"])
        if project_id not in existing_project_ids:
            continue
        item = ScriptElement(
            id=int(row["id"]),
            project_id=project_id,
            order_index=int(row["order_index"] or 0),
            block_type=str(row["block_type"] or row["element_type"] or "zk").strip() or "zk",
            text=str(row["text"] or ""),
            speaker_text=str(row["speaker_text"] or ""),
            file_name=str(row["file_name"] or ""),
            tc_in=str(row["tc_in"] or ""),
            tc_out=str(row["tc_out"] or ""),
            additional_comment=str(row["additional_comment"] or ""),
        )
        db.add(item)
        element_project_map[item.id] = project_id
    db.flush()
    return element_project_map


def _import_comments(
    conn: sqlite3.Connection,
    db: Session,
    *,
    available_columns: dict[str, set[str]],
    element_project_map: dict[int, int],
    existing_project_ids: set[int],
    existing_user_ids: set[int],
) -> int:
    comment_columns = available_columns.get("comments", set())
    rows = conn.execute("SELECT * FROM comments ORDER BY id").fetchall()
    imported = 0
    for row in rows:
        project_id: int | None = None
        if "project_id" in comment_columns and row["project_id"] is not None:
            project_id = int(row["project_id"])
        elif row["element_id"] is not None:
            project_id = element_project_map.get(int(row["element_id"]))
        if project_id is None or project_id not in existing_project_ids:
            continue

        legacy_prefix = ""
        if row["element_id"] is not None:
            legacy_prefix = f"[legacy element #{int(row['element_id'])}] "

        item = ProjectComment(
            id=int(row["id"]),
            project_id=project_id,
            user_id=int(row["user_id"]) if row["user_id"] in existing_user_ids else None,
            text=f"{legacy_prefix}{str(row['text'] or '').strip()}".strip(),
            created_at=_parse_legacy_dt(row["created_at"]),
        )
        db.add(item)
        imported += 1
    db.flush()
    return imported


def _resolve_legacy_file_path(
    *,
    legacy_storage_root: Path | None,
    storage_path_value: str,
) -> Path | None:
    raw_path = storage_path_value.strip()
    if not raw_path:
        return None
    source_path = Path(raw_path).expanduser()
    if source_path.is_absolute():
        return source_path
    if legacy_storage_root is None:
        return None
    return (legacy_storage_root / source_path).resolve()


def _import_project_files(
    conn: sqlite3.Connection,
    db: Session,
    *,
    existing_project_ids: set[int],
    existing_user_ids: set[int],
    target_storage_root: Path,
    legacy_storage_root: Path | None,
    copy_files: bool,
) -> tuple[int, int]:
    rows = conn.execute("SELECT * FROM project_files ORDER BY id").fetchall()
    imported = 0
    copied = 0

    for row in rows:
        project_id = int(row["project_id"])
        if project_id not in existing_project_ids:
            continue

        original_name = str(row["original_name"] or "").strip() or f"legacy-file-{row['id']}"
        destination_dir = target_storage_root / "projects" / str(project_id) / "project_files"
        destination_dir.mkdir(parents=True, exist_ok=True)
        destination_path = destination_dir / original_name

        source_path = _resolve_legacy_file_path(
            legacy_storage_root=legacy_storage_root,
            storage_path_value=str(row["storage_path"] or ""),
        )
        if copy_files and source_path is not None and source_path.exists():
            shutil.copy2(source_path, destination_path)
            copied += 1
        elif source_path is not None and source_path.exists():
            destination_path = source_path

        item = ProjectFile(
            id=int(row["id"]),
            project_id=project_id,
            original_name=original_name,
            storage_path=str(destination_path),
            mime_type=str(row["mime_type"] or ""),
            file_size=int(row["file_size"] or 0),
            uploaded_by=int(row["uploaded_by"]) if row["uploaded_by"] in existing_user_ids else None,
            uploaded_at=_parse_legacy_dt(row["uploaded_at"]),
        )
        db.add(item)
        imported += 1

    db.flush()
    return imported, copied


def _normalize_meta_json(raw_value: object) -> str | None:
    if raw_value is None:
        return None
    text_value = str(raw_value).strip()
    if not text_value:
        return None
    try:
        json.loads(text_value)
    except Exception:
        return json.dumps({"legacy_meta": text_value}, ensure_ascii=False, sort_keys=True)
    return text_value


def _import_project_events(
    conn: sqlite3.Connection,
    db: Session,
    *,
    existing_project_ids: set[int],
    existing_user_ids: set[int],
) -> int:
    rows = conn.execute("SELECT * FROM project_events ORDER BY id").fetchall()
    imported = 0
    for row in rows:
        project_id = int(row["project_id"])
        if project_id not in existing_project_ids:
            continue

        item = ProjectEvent(
            id=int(row["id"]),
            project_id=project_id,
            event_type=str(row["event_type"] or "").strip() or "legacy_event",
            old_value=_clean_optional_text(row["old_value"]),
            new_value=_clean_optional_text(row["new_value"]),
            actor_user_id=int(row["actor_user_id"]) if row["actor_user_id"] in existing_user_ids else None,
            created_at=_parse_legacy_dt(row["created_at"]),
            meta_json=_normalize_meta_json(row["meta_json"]),
        )
        db.add(item)
        imported += 1
    db.flush()
    return imported


def _sync_sequences(engine: Engine) -> None:
    if engine.dialect.name != "postgresql":
        return

    table_names = [
        User.__tablename__,
        Project.__tablename__,
        ScriptElement.__tablename__,
        ProjectComment.__tablename__,
        ProjectFile.__tablename__,
        ProjectEvent.__tablename__,
    ]
    with engine.begin() as conn:
        for table_name in table_names:
            conn.execute(
                text(
                    """
                    SELECT setval(
                        pg_get_serial_sequence(:table_name, 'id'),
                        COALESCE((SELECT MAX(id) FROM ONLY """ + table_name + """), 1),
                        COALESCE((SELECT MAX(id) IS NOT NULL FROM ONLY """ + table_name + """), false)
                    )
                    """
                ),
                {"table_name": table_name},
            )
