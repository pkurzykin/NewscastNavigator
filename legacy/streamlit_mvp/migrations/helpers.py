from __future__ import annotations

import sqlite3


def table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (table_name,),
    ).fetchone()
    return row is not None


def column_exists(conn: sqlite3.Connection, table_name: str, column_name: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    return any(row[1] == column_name for row in rows)


def add_column_if_missing(
    conn: sqlite3.Connection,
    table_name: str,
    column_name: str,
    column_definition: str,
) -> None:
    if column_exists(conn, table_name, column_name):
        return

    conn.execute(
        f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_definition}"
    )


def create_index_if_missing(
    conn: sqlite3.Connection,
    index_name: str,
    table_name: str,
    expression: str,
) -> None:
    conn.execute(
        f"CREATE INDEX IF NOT EXISTS {index_name} ON {table_name} ({expression})"
    )
