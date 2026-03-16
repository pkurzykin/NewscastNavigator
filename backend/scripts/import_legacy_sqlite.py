from __future__ import annotations

import argparse
import sys
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import get_settings
from app.db.session import SessionLocal, engine
from app.services.legacy_import import import_legacy_sqlite


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Import legacy Streamlit SQLite data into the new web database.",
    )
    parser.add_argument(
        "--sqlite-path",
        required=True,
        help="Path to legacy SQLite DB file",
    )
    parser.add_argument(
        "--legacy-storage-root",
        default="",
        help="Optional path to legacy storage root for copying project files",
    )
    parser.add_argument(
        "--no-copy-files",
        action="store_true",
        help="Do not copy files from legacy storage even if project_files rows exist",
    )
    parser.add_argument(
        "--allow-nonempty-target",
        action="store_true",
        help="Allow import into a non-empty target DB",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    settings = get_settings()
    legacy_storage_root = Path(args.legacy_storage_root) if args.legacy_storage_root else None

    result = import_legacy_sqlite(
        legacy_db_path=Path(args.sqlite_path),
        target_session_factory=SessionLocal,
        target_engine=engine,
        target_storage_root=Path(settings.storage_root),
        legacy_storage_root=legacy_storage_root,
        copy_files=not args.no_copy_files,
        require_empty_target=not args.allow_nonempty_target,
    )

    print("Legacy import completed:")
    print(f"- users: {result.users}")
    print(f"- projects: {result.projects}")
    print(f"- elements: {result.elements}")
    print(f"- comments: {result.comments}")
    print(f"- files: {result.files}")
    print(f"- copied_files: {result.copied_files}")
    print(f"- events: {result.events}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
