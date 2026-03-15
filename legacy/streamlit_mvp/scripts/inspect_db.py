from __future__ import annotations

import sqlite3
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
DB_PATH = ROOT_DIR / "data" / "app.db"


def main() -> None:
    if not DB_PATH.exists():
        print(f"Database file not found: {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    try:
        tables = [
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            ).fetchall()
        ]

        print("Tables:")
        for table in tables:
            print(f"- {table}")

        for table in tables:
            print(f"\n[{table}] columns:")
            for col in conn.execute(f"PRAGMA table_info({table})").fetchall():
                # cid, name, type, notnull, dflt_value, pk
                print(f"  - {col[1]} | {col[2]} | default={col[4]}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
