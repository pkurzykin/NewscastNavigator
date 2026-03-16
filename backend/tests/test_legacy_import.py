from __future__ import annotations

import sqlite3
from pathlib import Path

import bcrypt
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import Base
from app.db.models import Project, ProjectComment, ProjectEvent, ProjectFile, ScriptElement, User
from app.services.legacy_import import import_legacy_sqlite


def _create_legacy_source(db_path: Path, storage_root: Path) -> None:
    storage_root.mkdir(parents=True, exist_ok=True)
    legacy_file = storage_root / "legacy-note.txt"
    legacy_file.write_text("legacy file body", encoding="utf-8")

    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(
            """
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                username TEXT UNIQUE,
                password_hash TEXT,
                role TEXT
            );

            CREATE TABLE projects (
                id INTEGER PRIMARY KEY,
                title TEXT,
                topic TEXT,
                status TEXT,
                author_id INTEGER,
                created_at TEXT,
                rubric TEXT DEFAULT '',
                planned_duration TEXT DEFAULT '',
                source_project_id INTEGER,
                author_user_id INTEGER,
                executor_user_id INTEGER,
                proofreader_user_id INTEGER,
                is_archived INTEGER DEFAULT 0,
                archived_at TEXT,
                archived_by INTEGER,
                status_changed_at TEXT,
                status_changed_by INTEGER,
                file_root TEXT
            );

            CREATE TABLE script_elements (
                id INTEGER PRIMARY KEY,
                project_id INTEGER,
                order_index INTEGER,
                text TEXT,
                element_type TEXT,
                block_type TEXT DEFAULT 'zk',
                speaker_text TEXT DEFAULT '',
                file_name TEXT DEFAULT '',
                tc_in TEXT DEFAULT '',
                tc_out TEXT DEFAULT '',
                additional_comment TEXT DEFAULT ''
            );

            CREATE TABLE comments (
                id INTEGER PRIMARY KEY,
                element_id INTEGER,
                user_id INTEGER,
                text TEXT,
                created_at TEXT
            );

            CREATE TABLE project_files (
                id INTEGER PRIMARY KEY,
                project_id INTEGER,
                element_id INTEGER,
                original_name TEXT,
                storage_path TEXT,
                mime_type TEXT,
                file_size INTEGER,
                uploaded_by INTEGER,
                uploaded_at TEXT
            );

            CREATE TABLE project_events (
                id INTEGER PRIMARY KEY,
                project_id INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                old_value TEXT,
                new_value TEXT,
                actor_user_id INTEGER,
                created_at TEXT NOT NULL,
                meta_json TEXT
            );
            """
        )

        conn.execute(
            "INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)",
            (
                1,
                "legacy_admin",
                bcrypt.hashpw(b"secret123", bcrypt.gensalt()).decode("utf-8"),
                "admin",
            ),
        )
        conn.execute(
            "INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)",
            (
                2,
                "legacy_proof",
                bcrypt.hashpw(b"proof123", bcrypt.gensalt()).decode("utf-8"),
                "proofreader",
            ),
        )

        conn.execute(
            """
            INSERT INTO projects (
                id, title, topic, status, author_id, created_at, rubric, planned_duration,
                source_project_id, author_user_id, executor_user_id, proofreader_user_id,
                is_archived, archived_at, archived_by, status_changed_at, status_changed_by, file_root
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                10,
                "Legacy project",
                "Old topic",
                "in_editing",
                1,
                "2026-02-15T18:47:33",
                "Новости",
                "02:30",
                None,
                1,
                1,
                2,
                0,
                None,
                None,
                "2026-02-15T19:19:10",
                1,
                "",
            ),
        )

        conn.execute(
            """
            INSERT INTO script_elements (
                id, project_id, order_index, text, element_type, block_type, speaker_text,
                file_name, tc_in, tc_out, additional_comment
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                21,
                10,
                1,
                "Legacy text",
                "snh",
                "snh",
                "Иван\nИванов",
                "clip001",
                "00:10",
                "00:24",
                "legacy note",
            ),
        )

        conn.execute(
            "INSERT INTO comments (id, element_id, user_id, text, created_at) VALUES (?, ?, ?, ?, ?)",
            (31, 21, 1, "Legacy element comment", "2026-02-15T19:20:00"),
        )
        conn.execute(
            """
            INSERT INTO project_files (
                id, project_id, element_id, original_name, storage_path, mime_type, file_size, uploaded_by, uploaded_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                41,
                10,
                21,
                "legacy-note.txt",
                "legacy-note.txt",
                "text/plain",
                legacy_file.stat().st_size,
                1,
                "2026-02-15T19:55:56",
            ),
        )
        conn.execute(
            """
            INSERT INTO project_events (
                id, project_id, event_type, old_value, new_value, actor_user_id, created_at, meta_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                51,
                10,
                "status_changed",
                "draft",
                "in_editing",
                1,
                "2026-02-15T19:19:10",
                '{"source":"legacy"}',
            ),
        )
        conn.commit()
    finally:
        conn.close()


def test_import_legacy_sqlite_preserves_core_data(tmp_path: Path) -> None:
    legacy_db_path = tmp_path / "legacy.db"
    legacy_storage_root = tmp_path / "legacy-storage"
    target_storage_root = tmp_path / "target-storage"
    target_db_path = tmp_path / "target.db"

    _create_legacy_source(legacy_db_path, legacy_storage_root)

    engine = create_engine(f"sqlite+pysqlite:///{target_db_path}", future=True)
    Base.metadata.create_all(bind=engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False, class_=Session)

    result = import_legacy_sqlite(
        legacy_db_path=legacy_db_path,
        target_session_factory=session_factory,
        target_engine=engine,
        target_storage_root=target_storage_root,
        legacy_storage_root=legacy_storage_root,
    )

    assert result.users == 2
    assert result.projects == 1
    assert result.elements == 1
    assert result.comments == 1
    assert result.files == 1
    assert result.events == 1
    assert result.copied_files == 1

    with session_factory() as db:
        project = db.execute(select(Project).where(Project.id == 10)).scalar_one()
        assert project.title == "Legacy project"
        assert project.status == "in_editing"
        assert project.project_note == "Legacy topic: Old topic"
        assert project.author_user_id == 1
        assert project.proofreader_user_id == 2

        element = db.execute(select(ScriptElement).where(ScriptElement.id == 21)).scalar_one()
        assert element.project_id == 10
        assert element.speaker_text == "Иван\nИванов"

        comment = db.execute(select(ProjectComment).where(ProjectComment.id == 31)).scalar_one()
        assert comment.project_id == 10
        assert "legacy element #21" in comment.text

        file_row = db.execute(select(ProjectFile).where(ProjectFile.id == 41)).scalar_one()
        assert Path(file_row.storage_path).exists()
        assert Path(file_row.storage_path).read_text(encoding="utf-8") == "legacy file body"

        event = db.execute(select(ProjectEvent).where(ProjectEvent.id == 51)).scalar_one()
        assert event.meta_json == '{"source":"legacy"}'

        user = db.execute(select(User).where(User.id == 1)).scalar_one()
        assert user.password_hash.startswith("$2")
