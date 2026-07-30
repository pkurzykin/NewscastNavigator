from __future__ import annotations

import argparse
from collections.abc import Callable, Mapping
from dataclasses import dataclass
import hashlib
from importlib import metadata
import json
from pathlib import Path
import re
import sys
import tomllib

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name


ALLOWED_LICENSES = {
    "Apache-2.0",
    "Apache-2.0 OR BSD-2-Clause",
    "BSD",
    "BSD-3-Clause",
    "LGPL-3.0-only",
    "MIT",
    "MIT AND PSF-2.0",
    "MIT License",
    "MPL-2.0",
    "OFL-1.1",
    "PSF-2.0",
}

ONEST_FILES = {
    "frontend/public/fonts/onest/Onest-VariableFont.woff2": (
        "e117f6aee7c97fbc2f7e6514fa08a31ad43e7bd116105aeac15c8c1b8427f7db"
    ),
    "frontend/public/fonts/onest/OFL.txt": (
        "071195d8806e226faeee60259c28ca67b458227af5195a73f5cfcab06e3003bc"
    ),
}


@dataclass(frozen=True)
class LockedRequirement:
    version: str


def normalize_name(name: str) -> str:
    return canonicalize_name(name)


def requirements(path: Path) -> dict[str, Requirement]:
    parsed: dict[str, Requirement] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith(("#", "-")):
            continue
        requirement = Requirement(line)
        parsed[normalize_name(requirement.name)] = requirement
    return parsed


def lock_blocks(path: Path) -> list[str]:
    blocks: list[list[str]] = []
    current: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line and not line[0].isspace() and not line.startswith(("#", "--")):
            if current:
                blocks.append(current)
            current = [line]
        elif current:
            current.append(line)
    if current:
        blocks.append(current)
    return ["\n".join(block) for block in blocks]


def locked_requirements(path: Path) -> dict[str, LockedRequirement]:
    locked: dict[str, LockedRequirement] = {}
    for block in lock_blocks(path):
        first_line = block.splitlines()[0].rstrip(" \\")
        requirement = Requirement(first_line)
        versions = [
            specifier.version
            for specifier in requirement.specifier
            if specifier.operator == "=="
        ]
        if len(versions) != 1 or len(list(requirement.specifier)) != 1:
            raise ValueError(f"lock entry is not an exact version: {first_line}")
        locked[normalize_name(requirement.name)] = LockedRequirement(versions[0])
    return locked


def requirement_alignment_errors(
    direct: Mapping[str, Requirement],
    locked: Mapping[str, LockedRequirement],
) -> list[str]:
    errors: list[str] = []
    for name, requirement in sorted(direct.items()):
        locked_requirement = locked.get(name)
        if locked_requirement is None:
            errors.append(f"direct requirement missing from lock: {name}")
            continue
        if not requirement.specifier.contains(
            locked_requirement.version,
            prereleases=True,
        ):
            errors.append(
                f"locked {name}=={locked_requirement.version} does not satisfy "
                f"direct requirement {requirement}"
            )
    return errors


def runtime_lock_consistency_errors(
    runtime_locked: Mapping[str, LockedRequirement],
    development_locked: Mapping[str, LockedRequirement],
) -> list[str]:
    errors: list[str] = []
    for name, runtime_requirement in sorted(runtime_locked.items()):
        development_requirement = development_locked.get(name)
        if development_requirement is None:
            errors.append(f"runtime package missing from development lock: {name}")
        elif runtime_requirement.version != development_requirement.version:
            errors.append(
                f"runtime lock divergence in development lock: "
                f"{name} {runtime_requirement.version} != "
                f"{development_requirement.version}"
            )
    return errors


def _requirement_contract(requirement: Requirement) -> tuple[object, ...]:
    return (
        frozenset(requirement.extras),
        str(requirement.specifier),
        str(requirement.marker) if requirement.marker else None,
        requirement.url,
    )


def requirement_set_errors(
    expected: Mapping[str, Requirement],
    actual: Mapping[str, Requirement],
) -> list[str]:
    errors: list[str] = []
    missing = sorted(set(expected) - set(actual))
    extra = sorted(set(actual) - set(expected))
    if missing:
        errors.append(f"pyproject missing runtime requirements: {missing}")
    if extra:
        errors.append(f"pyproject has extra runtime requirements: {extra}")
    for name in sorted(set(expected) & set(actual)):
        if _requirement_contract(expected[name]) != _requirement_contract(actual[name]):
            errors.append(
                f"pyproject/runtime requirement mismatch: "
                f"{expected[name]} != {actual[name]}"
            )
    return errors


def notice_licenses(path: Path) -> dict[tuple[str, str], str]:
    notices: dict[tuple[str, str], str] = {}
    pattern = re.compile(
        r"^\|\s*`(?P<name>[^`]+)`\s*\|\s*(?P<ecosystem>Python|npm|Asset)\s*"
        r"\|\s*`(?P<license>[^`]+)`\s*\|"
    )
    for line in path.read_text(encoding="utf-8").splitlines():
        match = pattern.match(line)
        if match:
            notices[
                (match["ecosystem"], normalize_name(match["name"]))
            ] = match["license"]
    return notices


def _installed_python_metadata(name: str) -> tuple[str, str | None]:
    package_metadata = metadata.metadata(name)
    license_name = package_metadata.get("License-Expression") or package_metadata.get(
        "License"
    )
    return metadata.version(name), license_name


def python_license_errors(
    names: set[str],
    locked: Mapping[str, LockedRequirement],
    notices: Mapping[tuple[str, str], str],
    *,
    metadata_reader: Callable[[str], tuple[str, str | None]] = (
        _installed_python_metadata
    ),
) -> list[str]:
    errors: list[str] = []
    for name in sorted(names):
        try:
            installed_version, raw_license = metadata_reader(name)
        except metadata.PackageNotFoundError:
            errors.append(f"Python dependency is not installed: {name}")
            continue
        license_name = raw_license.strip() if raw_license else ""
        if not license_name or license_name.casefold() in {"unknown", "n/a"}:
            errors.append(f"Python dependency has no usable license metadata: {name}")
            continue
        locked_requirement = locked.get(name)
        if locked_requirement and installed_version != locked_requirement.version:
            errors.append(
                f"installed Python version/lock mismatch: "
                f"{name} {installed_version} != {locked_requirement.version}"
            )
        if license_name not in ALLOWED_LICENSES:
            errors.append(
                f"unreviewed Python dependency license: {name} {license_name}"
            )
        notice_license = notices.get(("Python", name))
        if notice_license is None:
            errors.append(f"missing dependency notice: Python {name}")
        elif license_name != notice_license:
            errors.append(
                f"Python license metadata/notices mismatch: "
                f"{name} {license_name} != {notice_license}"
            )
    return errors


def npm_license_errors(
    package: Mapping[str, object],
    package_lock: Mapping[str, object],
    notices: Mapping[tuple[str, str], str],
) -> list[str]:
    errors: list[str] = []
    packages = package_lock.get("packages")
    if not isinstance(packages, dict):
        return ["frontend package-lock has no packages inventory"]
    lock_root = packages.get("")
    if not isinstance(lock_root, dict):
        return ["frontend package-lock has no root package entry"]

    for group in ("dependencies", "devDependencies"):
        declared = package.get(group)
        if not isinstance(declared, dict):
            errors.append(f"frontend package.json has no {group} mapping")
            continue
        if lock_root.get(group) != declared:
            errors.append(f"frontend package-lock drift in {group}")
        for raw_name in sorted(declared):
            name = normalize_name(raw_name)
            entry = packages.get(f"node_modules/{raw_name}")
            if not isinstance(entry, dict):
                errors.append(
                    f"missing package-lock entry for direct npm dependency {name}"
                )
                continue
            raw_license = entry.get("license")
            license_name = raw_license.strip() if isinstance(raw_license, str) else ""
            if not license_name:
                errors.append(
                    f"direct npm dependency {name} has no package-lock license metadata"
                )
                continue
            if license_name not in ALLOWED_LICENSES:
                errors.append(
                    f"unreviewed direct npm dependency license: {name} {license_name}"
                )
                continue
            notice_license = notices.get(("npm", name))
            if notice_license is None:
                errors.append(f"missing dependency notice: npm {name}")
            elif license_name != notice_license:
                errors.append(
                    f"npm license metadata/notices mismatch: "
                    f"{name} {license_name} != {notice_license}"
                )
    return errors


def asset_license_errors(
    repo_root: Path,
    notices: Mapping[tuple[str, str], str],
) -> list[str]:
    errors: list[str] = []
    for relative_path, expected_digest in ONEST_FILES.items():
        path = repo_root / relative_path
        if not path.is_file():
            errors.append(f"missing bundled Onest asset: {relative_path}")
            continue
        actual_digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual_digest != expected_digest:
            errors.append(
                f"bundled Onest asset hash mismatch: "
                f"{relative_path} {actual_digest} != {expected_digest}"
            )
    notice_license = notices.get(("Asset", "onest"))
    if notice_license is None:
        errors.append("missing dependency notice: Asset onest")
    elif notice_license != "OFL-1.1":
        errors.append(
            f"bundled Onest notice mismatch: {notice_license} != OFL-1.1"
        )
    return errors


def check(repo_root: Path) -> list[str]:
    backend = repo_root / "backend"
    frontend = repo_root / "frontend"
    notices = notice_licenses(repo_root / "docs/THIRD_PARTY_NOTICES.md")

    runtime = requirements(backend / "requirements.txt")
    development = requirements(backend / "requirements-dev.txt")
    runtime_lock = locked_requirements(backend / "requirements.lock")
    development_lock = locked_requirements(backend / "requirements-dev.lock")
    pyproject = tomllib.loads((backend / "pyproject.toml").read_text(encoding="utf-8"))
    project_runtime = {
        normalize_name(requirement.name): requirement
        for raw in pyproject["project"]["dependencies"]
        for requirement in (Requirement(raw),)
    }

    errors = [
        *requirement_alignment_errors(runtime, runtime_lock),
        *requirement_alignment_errors(runtime | development, development_lock),
        *runtime_lock_consistency_errors(runtime_lock, development_lock),
        *requirement_set_errors(runtime, project_runtime),
    ]

    inventory_lock = runtime_lock | {
        name: development_lock[name]
        for name in development
        if name not in runtime_lock and name in development_lock
    }
    errors.extend(
        python_license_errors(
            set(runtime_lock) | set(development),
            inventory_lock,
            notices,
        )
    )

    package = json.loads((frontend / "package.json").read_text(encoding="utf-8"))
    package_lock = json.loads(
        (frontend / "package-lock.json").read_text(encoding="utf-8")
    )
    errors.extend(npm_license_errors(package, package_lock, notices))
    errors.extend(asset_license_errors(repo_root, notices))
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate dependency locks, metadata, licenses and notices."
    )
    parser.add_argument("--repo-root", type=Path, required=True)
    args = parser.parse_args()

    errors = check(args.repo_root.resolve())
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1

    print("Dependency, metadata and license policy: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
