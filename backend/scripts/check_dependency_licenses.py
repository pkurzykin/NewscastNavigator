from __future__ import annotations

import argparse
from importlib import metadata
import json
from pathlib import Path
import re
import sys


ALLOWED_LICENSES = {
    "Apache-2.0",
    "BSD-3-Clause",
    "LGPL-3.0-only",
    "MIT",
    "MPL-2.0",
}


def normalize_name(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).casefold()


def requirement_names(path: Path) -> set[str]:
    names: set[str] = set()
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith(("#", "-")):
            continue
        names.add(normalize_name(re.split(r"[<>=!~\[]", line, maxsplit=1)[0]))
    return names


def notice_licenses(path: Path) -> dict[tuple[str, str], str]:
    notices: dict[tuple[str, str], str] = {}
    pattern = re.compile(
        r"^\|\s*`(?P<name>[^`]+)`\s*\|\s*(?P<ecosystem>Python|npm)\s*"
        r"\|\s*`(?P<license>[^`]+)`\s*\|"
    )
    for line in path.read_text(encoding="utf-8").splitlines():
        match = pattern.match(line)
        if match:
            notices[(match["ecosystem"], normalize_name(match["name"]))] = match["license"]
    return notices


def installed_python_licenses(names: set[str]) -> dict[str, str]:
    installed: dict[str, str] = {}
    for name in names:
        package = metadata.metadata(name)
        license_name = package.get("License-Expression") or package.get("License")
        if not license_name or license_name.strip().casefold() in {"unknown", "n/a"}:
            raise ValueError(f"Python dependency has no usable license metadata: {name}")
        installed[name] = license_name.strip()
    return installed


def check(repo_root: Path) -> list[str]:
    errors: list[str] = []
    backend = repo_root / "backend"
    frontend = repo_root / "frontend"

    runtime = requirement_names(backend / "requirements.txt")
    development = requirement_names(backend / "requirements-dev.txt")
    python_direct = runtime | development

    package = json.loads((frontend / "package.json").read_text(encoding="utf-8"))
    package_lock = json.loads((frontend / "package-lock.json").read_text(encoding="utf-8"))
    npm_direct = {
        normalize_name(name)
        for group in ("dependencies", "devDependencies")
        for name in package[group]
    }

    lock_root = package_lock.get("packages", {}).get("", {})
    for group in ("dependencies", "devDependencies"):
        if lock_root.get(group) != package[group]:
            errors.append(f"frontend package-lock drift in {group}")

    notices = notice_licenses(repo_root / "docs/THIRD_PARTY_NOTICES.md")
    required_notice_keys = {
        *(("Python", name) for name in python_direct),
        *(("npm", name) for name in npm_direct),
    }
    missing = sorted(required_notice_keys - notices.keys())
    if missing:
        errors.append(f"missing direct dependency notices: {missing}")

    unsupported = sorted(
        (ecosystem, name, license_name)
        for (ecosystem, name), license_name in notices.items()
        if (ecosystem, name) in required_notice_keys and license_name not in ALLOWED_LICENSES
    )
    if unsupported:
        errors.append(f"unreviewed direct dependency licenses: {unsupported}")

    try:
        installed = installed_python_licenses(python_direct)
    except metadata.PackageNotFoundError as exc:
        errors.append(f"direct Python dependency is not installed: {exc.name}")
    except ValueError as exc:
        errors.append(str(exc))
    else:
        mismatched = sorted(
            (name, installed[name], notices[("Python", name)])
            for name in python_direct
            if installed[name] != notices.get(("Python", name))
        )
        if mismatched:
            errors.append(f"Python license metadata/notices mismatch: {mismatched}")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate direct dependency locks, license metadata and notices."
    )
    parser.add_argument("--repo-root", type=Path, required=True)
    args = parser.parse_args()

    repo_root = args.repo_root.resolve()
    errors = check(repo_root)
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1

    print("Dependency and direct-license policy: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
