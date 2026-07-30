from __future__ import annotations

import argparse
import json
import os
from pathlib import Path


SECRET_FILE_SUFFIXES = {".key", ".pem", ".p12", ".pfx"}
SECRET_FILE_NAMES = {".npmrc", ".pypirc", "id_rsa", "id_ed25519"}
SECRET_FILE_MARKERS = ("credential", "password", "secret")
SECRET_MARKER_SUFFIXES = {"", ".json", ".txt", ".yaml", ".yml"}


def scan_source_context(root: Path) -> dict[str, int]:
    counts = {
        "real_env_files": 0,
        "secret_like_files": 0,
        "appledouble_files": 0,
    }
    for _directory, _subdirectories, filenames in os.walk(root):
        for filename in filenames:
            lowered = filename.casefold()
            if filename.startswith("._"):
                counts["appledouble_files"] += 1

            is_env_example = lowered.endswith(".env.example")
            is_real_env = (
                lowered == ".env"
                or lowered.startswith(".env.")
                or lowered.endswith(".env")
                or ".env." in lowered
            )
            if is_real_env and not is_env_example:
                counts["real_env_files"] += 1

            suffix = Path(lowered).suffix
            is_secret_like = (
                suffix in SECRET_FILE_SUFFIXES
                or lowered in SECRET_FILE_NAMES
                or (
                    suffix in SECRET_MARKER_SUFFIXES
                    and any(marker in lowered for marker in SECRET_FILE_MARKERS)
                )
            )
            if is_secret_like:
                counts["secret_like_files"] += 1
    return counts


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(scan_source_context(args.root), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
