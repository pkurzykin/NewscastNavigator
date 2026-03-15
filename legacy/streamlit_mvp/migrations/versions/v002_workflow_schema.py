from __future__ import annotations

import sqlite3

from migrations.helpers import add_column_if_missing, create_index_if_missing


def upgrade(conn: sqlite3.Connection) -> None:
    # Project-level metadata from MAIN and text-editor sheets.
    add_column_if_missing(conn, "projects", "rubric", "TEXT DEFAULT ''")
    add_column_if_missing(conn, "projects", "planned_duration", "TEXT DEFAULT ''")
    add_column_if_missing(conn, "projects", "source_project_id", "INTEGER")

    # Assignment fields for roles in workflow.
    add_column_if_missing(conn, "projects", "author_user_id", "INTEGER")
    add_column_if_missing(conn, "projects", "executor_user_id", "INTEGER")
    add_column_if_missing(conn, "projects", "proofreader_user_id", "INTEGER")

    # Archive and status tracking.
    add_column_if_missing(conn, "projects", "is_archived", "INTEGER DEFAULT 0")
    add_column_if_missing(conn, "projects", "archived_at", "TEXT")
    add_column_if_missing(conn, "projects", "archived_by", "INTEGER")
    add_column_if_missing(conn, "projects", "status_changed_at", "TEXT")
    add_column_if_missing(conn, "projects", "status_changed_by", "INTEGER")

    # Local storage root for project-related files.
    add_column_if_missing(conn, "projects", "file_root", "TEXT")

    # Row-level metadata from text-editor grid.
    add_column_if_missing(conn, "script_elements", "block_type", "TEXT DEFAULT 'zk'")
    add_column_if_missing(conn, "script_elements", "speaker_text", "TEXT DEFAULT ''")
    add_column_if_missing(conn, "script_elements", "file_name", "TEXT DEFAULT ''")
    add_column_if_missing(conn, "script_elements", "tc_in", "TEXT DEFAULT ''")
    add_column_if_missing(conn, "script_elements", "tc_out", "TEXT DEFAULT ''")
    add_column_if_missing(conn, "script_elements", "additional_comment", "TEXT DEFAULT ''")

    # One-time backfill for old records.
    conn.execute(
        """
        UPDATE script_elements
        SET block_type = COALESCE(NULLIF(element_type, ''), 'zk')
        WHERE block_type IS NULL OR block_type = ''
        """
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS project_events (
            id INTEGER PRIMARY KEY,
            project_id INTEGER NOT NULL,
            event_type TEXT NOT NULL,
            old_value TEXT,
            new_value TEXT,
            actor_user_id INTEGER,
            created_at TEXT NOT NULL,
            meta_json TEXT,
            FOREIGN KEY(project_id) REFERENCES projects(id)
        )
        """
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS project_files (
            id INTEGER PRIMARY KEY,
            project_id INTEGER NOT NULL,
            element_id INTEGER,
            original_name TEXT NOT NULL,
            storage_path TEXT NOT NULL,
            mime_type TEXT,
            file_size INTEGER,
            uploaded_by INTEGER,
            uploaded_at TEXT NOT NULL,
            FOREIGN KEY(project_id) REFERENCES projects(id),
            FOREIGN KEY(element_id) REFERENCES script_elements(id)
        )
        """
    )

    create_index_if_missing(conn, "idx_projects_archived", "projects", "is_archived")
    create_index_if_missing(conn, "idx_projects_source", "projects", "source_project_id")
    create_index_if_missing(conn, "idx_script_elements_block", "script_elements", "block_type")
    create_index_if_missing(conn, "idx_project_events_project", "project_events", "project_id")
    create_index_if_missing(conn, "idx_project_events_type", "project_events", "event_type")
    create_index_if_missing(conn, "idx_project_files_project", "project_files", "project_id")
