from __future__ import annotations

import argparse
import shutil
from datetime import datetime
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT_DIR / "data"
DB_FILE = DATA_DIR / "app.db"
STORAGE_DIR = ROOT_DIR / "storage"
RESTORE_TEST_DIR = ROOT_DIR / "restore_test"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Restore backup created by backup_local_data.py")
    parser.add_argument("--backup-dir", required=True, help="Path to backup_YYYYMMDD_HHMMSS directory")
    parser.add_argument(
        "--mode",
        choices=["test", "live"],
        default="test",
        help="test: restore to restore_test/..., live: replace working data/storage",
    )
    parser.add_argument(
        "--confirm-live",
        action="store_true",
        help="Required for --mode live to prevent accidental overwrite",
    )
    return parser.parse_args()


def restore_test_mode(backup_dir: Path) -> None:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    target_dir = RESTORE_TEST_DIR / f"restore_{backup_dir.name}_{timestamp}"
    target_dir.mkdir(parents=True, exist_ok=False)

    db_src = backup_dir / "app.db"
    storage_src = backup_dir / "storage"
    if db_src.exists():
        shutil.copy2(db_src, target_dir / "app.db")
    if storage_src.exists():
        shutil.copytree(storage_src, target_dir / "storage")

    print(f"Test restore created in: {target_dir}")


def restore_live_mode(backup_dir: Path, confirm_live: bool) -> None:
    if not confirm_live:
        raise SystemExit("Live restore blocked. Add --confirm-live to continue.")

    db_src = backup_dir / "app.db"
    storage_src = backup_dir / "storage"
    if not db_src.exists():
        raise SystemExit(f"Backup DB not found: {db_src}")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    if DB_FILE.exists():
        old_db = DATA_DIR / f"app.db.pre_restore_{timestamp}"
        shutil.move(str(DB_FILE), str(old_db))
        print(f"Current DB moved to: {old_db}")
    shutil.copy2(db_src, DB_FILE)
    print(f"DB restored from: {db_src}")

    if storage_src.exists():
        if STORAGE_DIR.exists():
            old_storage = ROOT_DIR / f"storage.pre_restore_{timestamp}"
            shutil.move(str(STORAGE_DIR), str(old_storage))
            print(f"Current storage moved to: {old_storage}")
        shutil.copytree(storage_src, STORAGE_DIR)
        print(f"Storage restored from: {storage_src}")
    else:
        print("Backup does not contain storage directory; storage was not changed.")


def main() -> None:
    args = parse_args()
    backup_dir = Path(args.backup_dir).expanduser()
    if not backup_dir.is_absolute():
        backup_dir = (ROOT_DIR / backup_dir).resolve()

    if not backup_dir.exists() or not backup_dir.is_dir():
        raise SystemExit(f"Backup directory not found: {backup_dir}")

    if args.mode == "test":
        restore_test_mode(backup_dir)
        return

    restore_live_mode(backup_dir, args.confirm_live)


if __name__ == "__main__":
    main()
