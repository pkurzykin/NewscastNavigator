import sqlite3
from pathlib import Path

from migrations.runner import run_migrations

DB_PATH = Path("data/app.db")


def get_conn():
    return sqlite3.connect(DB_PATH, check_same_thread=False)


def init_db():
    conn = get_conn()
    try:
        run_migrations(conn)
        conn.commit()
    finally:
        conn.close()
