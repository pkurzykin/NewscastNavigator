from __future__ import annotations

import sqlite3


def upgrade(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            username TEXT UNIQUE,
            password_hash TEXT,
            role TEXT
        )
        """
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY,
            title TEXT,
            topic TEXT,
            status TEXT,
            author_id INTEGER,
            created_at TEXT
        )
        """
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS script_elements (
            id INTEGER PRIMARY KEY,
            project_id INTEGER,
            order_index INTEGER,
            text TEXT,
            element_type TEXT
        )
        """
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY,
            element_id INTEGER,
            user_id INTEGER,
            text TEXT,
            created_at TEXT
        )
        """
    )

    conn.execute("CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_script_elements_project ON script_elements(project_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_comments_element ON comments(element_id)")
