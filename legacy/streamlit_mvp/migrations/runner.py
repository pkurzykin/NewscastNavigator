from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from typing import Callable, Sequence

from migrations.versions.v001_initial import upgrade as upgrade_v001_initial
from migrations.versions.v002_workflow_schema import upgrade as upgrade_v002_workflow_schema
from migrations.versions.v003_comments_project_scope import (
    upgrade as upgrade_v003_comments_project_scope,
)

Migration = tuple[str, Callable[[sqlite3.Connection], None]]


MIGRATIONS: Sequence[Migration] = (
    ("001_initial", upgrade_v001_initial),
    ("002_workflow_schema", upgrade_v002_workflow_schema),
    ("003_comments_project_scope", upgrade_v003_comments_project_scope),
)


def _ensure_migrations_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        )
        """
    )


def _is_applied(conn: sqlite3.Connection, version: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM schema_migrations WHERE version = ?",
        (version,),
    ).fetchone()
    return row is not None


def run_migrations(conn: sqlite3.Connection) -> list[str]:
    _ensure_migrations_table(conn)

    applied_now: list[str] = []
    for version, migration_fn in MIGRATIONS:
        if _is_applied(conn, version):
            continue

        migration_fn(conn)
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
            (version, datetime.now(timezone.utc).isoformat()),
        )
        applied_now.append(version)

    return applied_now
