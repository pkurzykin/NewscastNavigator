from __future__ import annotations

import json
import os
import shutil
from datetime import datetime
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
DB_FILE = ROOT_DIR / "data" / "app.db"
DEFAULT_STORAGE_ROOT = ROOT_DIR / "storage"
BACKUPS_DIR = ROOT_DIR / "backups"


def resolve_storage_root() -> Path:
    env_value = os.getenv("NEWSCAST_STORAGE_ROOT", "").strip()
    if not env_value:
        return DEFAULT_STORAGE_ROOT
    root = Path(env_value).expanduser()
    if not root.is_absolute():
        root = (ROOT_DIR / root).resolve()
    return root


def main() -> None:
    storage_root = resolve_storage_root()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_dir = BACKUPS_DIR / f"backup_{timestamp}"
    backup_dir.mkdir(parents=True, exist_ok=False)

    manifest: dict[str, str | bool] = {
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "db_backup": "",
        "storage_backup": "",
        "storage_exists": storage_root.exists(),
    }

    if DB_FILE.exists():
        db_target = backup_dir / "app.db"
        shutil.copy2(DB_FILE, db_target)
        manifest["db_backup"] = str(db_target)
    else:
        manifest["db_backup"] = "missing"

    if storage_root.exists() and storage_root.is_dir():
        storage_target = backup_dir / "storage"
        shutil.copytree(storage_root, storage_target)
        manifest["storage_backup"] = str(storage_target)
    else:
        manifest["storage_backup"] = "missing"

    manifest_path = backup_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=True, indent=2), encoding="utf-8")

    print(f"Backup created: {backup_dir}")
    print(f"Manifest: {manifest_path}")


if __name__ == "__main__":
    main()
