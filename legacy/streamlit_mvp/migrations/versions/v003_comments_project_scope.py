from __future__ import annotations

import sqlite3

from migrations.helpers import add_column_if_missing, create_index_if_missing


def upgrade(conn: sqlite3.Connection) -> None:
    add_column_if_missing(conn, "comments", "project_id", "INTEGER")

    # Backfill project_id for old row-level comments.
    conn.execute(
        """
        UPDATE comments
        SET project_id = (
            SELECT se.project_id
            FROM script_elements se
            WHERE se.id = comments.element_id
            LIMIT 1
        )
        WHERE project_id IS NULL AND element_id IS NOT NULL
        """
    )

    create_index_if_missing(conn, "idx_comments_project", "comments", "project_id")
