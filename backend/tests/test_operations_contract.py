from __future__ import annotations

import hashlib
import os
from pathlib import Path
import shutil
import subprocess

import pytest
import yaml


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_ROOT = REPO_ROOT / "deploy" / "scripts"
REHEARSAL = SCRIPTS_ROOT / "rehearse_clean_deploy.sh"
BACKUP = SCRIPTS_ROOT / "backup_db.sh"
RESTORE = SCRIPTS_ROOT / "restore_db.sh"
SOURCE_SCANNER = SCRIPTS_ROOT / "scan_source_context.py"
UPDATE_DEMO = SCRIPTS_ROOT / "update_demo_stack.sh"

LEGACY_OPERATION_PATHS = {
    "deploy/docker/docker-compose.web-dev.yml",
    "deploy/docker/docker-compose.web-prod.yml",
    "deploy/env/web-dev.env.example",
    "deploy/env/web-prod.env.example",
    "deploy/nginx/conf.d/.gitkeep",
    "deploy/nginx/edge-nginx.conf",
    "deploy/nginx/templates/edge-proxy.conf.template",
    "deploy/systemd/.gitkeep",
    "deploy/scripts/backup_exports.sh",
    "deploy/scripts/restore_exports.sh",
    "deploy/scripts/backup_storage.sh",
    "deploy/scripts/restore_storage.sh",
    "deploy/scripts/dev_up.sh",
    "deploy/scripts/dev_down.sh",
    "deploy/scripts/dev_logs.sh",
    "deploy/scripts/dev_rebuild.sh",
    "deploy/scripts/dev_native_backend.sh",
    "deploy/scripts/dev_native_frontend.sh",
    "deploy/scripts/setup_backend_venv.sh",
    "deploy/scripts/server_audit_snapshot.sh",
    "deploy/scripts/status_prod_stack.sh",
    "deploy/scripts/update_prod_stack.sh",
}


def _run_bash(
    script: Path,
    *args: str,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(script), *args],
        cwd=REPO_ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


def _write_fake_docker(tmp_path: Path, *, relation_count: int) -> tuple[dict[str, str], Path]:
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    log_path = tmp_path / "docker.log"
    docker = fake_bin / "docker"
    docker.write_text(
        """#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FAKE_DOCKER_LOG"
if [[ "$*" == *"information_schema.tables"* ]]; then
  printf '%s\\n' "$FAKE_RELATION_COUNT"
  exit 0
fi
if [[ "$*" == *"pg_dump"* ]]; then
  printf 'synthetic-custom-dump'
  exit 0
fi
cat >/dev/null || true
""",
        encoding="utf-8",
    )
    docker.chmod(0o755)
    env = dict(os.environ)
    env.update(
        {
            "PATH": f"{fake_bin}{os.pathsep}{env['PATH']}",
            "FAKE_DOCKER_LOG": str(log_path),
            "FAKE_RELATION_COUNT": str(relation_count),
        }
    )
    return env, log_path


def _write_eval_inputs(tmp_path: Path) -> tuple[Path, Path, Path]:
    compose_file = tmp_path / "compose.yaml"
    compose_file.write_text("services:\n  db:\n    image: postgres:16-alpine\n", encoding="utf-8")
    env_file = tmp_path / "eval.env"
    env_file.write_text(
        "POSTGRES_DB=newscast_eval\n"
        "POSTGRES_USER=newscast_eval\n"
        "POSTGRES_PASSWORD=synthetic-only\n",
        encoding="utf-8",
    )
    backup_file = tmp_path / "backup.dump"
    backup_file.write_bytes(b"synthetic-backup")
    digest = hashlib.sha256(backup_file.read_bytes()).hexdigest()
    backup_file.with_suffix(".dump.sha256").write_text(
        f"{digest}  {backup_file.name}\n",
        encoding="utf-8",
    )
    return compose_file, env_file, backup_file


def test_only_canonical_local_test_and_demo_compose_paths_remain() -> None:
    assert (REPO_ROOT / "compose.yaml").is_file()
    assert (REPO_ROOT / "compose.test.yaml").is_file()
    assert (REPO_ROOT / "deploy/compose.demo.yaml").is_file()
    assert (REPO_ROOT / "deploy/env/demo.env.example").is_file()
    assert sorted(path for path in LEGACY_OPERATION_PATHS if (REPO_ROOT / path).exists()) == []


def test_compose_contract_has_one_local_and_one_demo_path_without_removed_runtime() -> None:
    local = yaml.safe_load((REPO_ROOT / "compose.yaml").read_text(encoding="utf-8"))
    demo = yaml.safe_load(
        (REPO_ROOT / "deploy/compose.demo.yaml").read_text(encoding="utf-8")
    )
    test = yaml.safe_load((REPO_ROOT / "compose.test.yaml").read_text(encoding="utf-8"))

    assert set(local["services"]) == {"db", "backend", "frontend"}
    assert set(demo["services"]) == {"db", "backend", "frontend", "gateway"}
    assert set(test["services"]) == {"db", "backend-tests"}
    test_backend = test["services"]["backend-tests"]
    assert test_backend["image"] == "python:3.11-bookworm"
    assert "command -v git" in "\n".join(test_backend["entrypoint"])
    assert test_backend["environment"]["GIT_CONFIG_COUNT"] == "1"
    assert test_backend["environment"]["GIT_CONFIG_KEY_0"] == "safe.directory"
    assert test_backend["environment"]["GIT_CONFIG_VALUE_0"] == "/workspace"
    serialized = "\n".join(
        path.read_text(encoding="utf-8")
        for path in (
            REPO_ROOT / "compose.yaml",
            REPO_ROOT / "compose.test.yaml",
            REPO_ROOT / "deploy/compose.demo.yaml",
            REPO_ROOT / ".env.example",
            REPO_ROOT / "deploy/env/demo.env.example",
            REPO_ROOT / ".github/workflows/ci.yml",
        )
    )
    for forbidden in (
        "bootstrap_runtime.py",
        "STORAGE_PATH",
        "EXPORT_PATH",
        "web_storage",
        "web_exports",
        "edge-nginx",
    ):
        assert forbidden not in serialized

    assert demo["services"]["backend"]["environment"]["ENVIRONMENT"] == "production"
    assert demo["services"]["backend"]["environment"]["SEED_DEMO_DATA"] == "false"
    assert demo["services"]["backend"]["environment"]["SESSION_COOKIE_SECURE"] == "true"
    assert demo["services"]["backend"]["build"]["dockerfile"] == "Dockerfile.prod"
    assert demo["services"]["frontend"]["build"]["dockerfile"] == "Dockerfile.prod"
    assert demo["services"]["gateway"]["build"]["dockerfile"] == "Dockerfile"
    assert "volumes" not in demo["services"]["backend"]
    assert "volumes" not in demo["services"]["frontend"]
    assert "volumes" not in demo["services"]["gateway"]
    assert "/etc/nginx/conf.d" in demo["services"]["gateway"]["tmpfs"]
    assert demo["services"]["gateway"].get("privileged") is not True


def test_rehearsal_rejects_non_eval_project_before_any_docker_call(tmp_path: Path) -> None:
    env, log_path = _write_fake_docker(tmp_path, relation_count=0)
    result = _run_bash(
        REHEARSAL,
        "--project-name",
        "newscast-production",
        "--artifacts",
        str(tmp_path / "artifacts"),
        env=env,
    )

    assert result.returncode != 0
    assert "nn-product-reset-eval-" in result.stderr
    assert not log_path.exists()


def test_restore_rejects_checksum_mismatch_before_docker(tmp_path: Path) -> None:
    env, log_path = _write_fake_docker(tmp_path, relation_count=0)
    compose_file, env_file, backup_file = _write_eval_inputs(tmp_path)
    backup_file.with_suffix(".dump.sha256").write_text(
        f"{'0' * 64}  {backup_file.name}\n",
        encoding="utf-8",
    )

    result = _run_bash(
        RESTORE,
        "--project-name",
        "nn-product-reset-eval-contract",
        "--compose-file",
        str(compose_file),
        "--env-file",
        str(env_file),
        "--input",
        str(backup_file),
        env=env,
    )

    assert result.returncode != 0
    assert "checksum" in result.stderr.casefold()
    assert not log_path.exists()


def test_restore_rejects_nonempty_eval_database_without_importing(tmp_path: Path) -> None:
    env, log_path = _write_fake_docker(tmp_path, relation_count=1)
    compose_file, env_file, backup_file = _write_eval_inputs(tmp_path)

    result = _run_bash(
        RESTORE,
        "--project-name",
        "nn-product-reset-eval-contract",
        "--compose-file",
        str(compose_file),
        "--env-file",
        str(env_file),
        "--input",
        str(backup_file),
        env=env,
    )

    assert result.returncode != 0
    assert "empty" in result.stderr.casefold() or "пуст" in result.stderr.casefold()
    commands = log_path.read_text(encoding="utf-8")
    assert "information_schema.tables" in commands
    assert "pg_restore" not in commands


def test_restore_imports_checksum_verified_backup_into_empty_eval_database(
    tmp_path: Path,
) -> None:
    env, log_path = _write_fake_docker(tmp_path, relation_count=0)
    compose_file, env_file, backup_file = _write_eval_inputs(tmp_path)

    result = _run_bash(
        RESTORE,
        "--project-name",
        "nn-product-reset-eval-contract",
        "--compose-file",
        str(compose_file),
        "--env-file",
        str(env_file),
        "--input",
        str(backup_file),
        env=env,
    )

    assert result.returncode == 0, result.stderr
    commands = log_path.read_text(encoding="utf-8")
    assert "information_schema.tables" in commands
    assert "pg_restore" in commands


def test_backup_writes_custom_dump_and_checksum(tmp_path: Path) -> None:
    env, _log_path = _write_fake_docker(tmp_path, relation_count=0)
    compose_file, env_file, _backup_file = _write_eval_inputs(tmp_path)
    output_dir = tmp_path / "output"

    result = _run_bash(
        BACKUP,
        "--project-name",
        "nn-product-reset-eval-contract",
        "--compose-file",
        str(compose_file),
        "--env-file",
        str(env_file),
        "--output",
        str(output_dir),
        env=env,
    )

    assert result.returncode == 0, result.stderr
    dumps = list(output_dir.glob("*.dump"))
    assert len(dumps) == 1
    assert dumps[0].read_bytes() == b"synthetic-custom-dump"
    assert dumps[0].with_suffix(".dump.sha256").is_file()


def test_backup_can_write_one_exact_fresh_dump_path(tmp_path: Path) -> None:
    env, _log_path = _write_fake_docker(tmp_path, relation_count=0)
    compose_file, env_file, _backup_file = _write_eval_inputs(tmp_path)
    output_dir = tmp_path / "run" / "backup"
    output_dir.mkdir(parents=True)
    (output_dir / "stale.dump").write_bytes(b"stale")
    (output_dir / "._stale.dump").write_bytes(b"appledouble")
    output_file = output_dir / "postgres.dump"

    result = _run_bash(
        BACKUP,
        "--project-name",
        "nn-product-reset-eval-contract",
        "--compose-file",
        str(compose_file),
        "--env-file",
        str(env_file),
        "--output-file",
        str(output_file),
        env=env,
    )

    assert result.returncode == 0, result.stderr
    assert output_file.read_bytes() == b"synthetic-custom-dump"
    assert output_file.with_suffix(".dump.sha256").is_file()
    assert "postgres.dump" in output_file.with_suffix(".dump.sha256").read_text(
        encoding="utf-8"
    )


def test_all_kept_operation_scripts_have_valid_bash_syntax() -> None:
    scripts = sorted(
        script
        for script in SCRIPTS_ROOT.glob("*.sh")
        if not script.name.startswith("._")
    )
    assert scripts
    for script in scripts:
        completed = subprocess.run(
            ["bash", "-n", str(script)],
            text=True,
            capture_output=True,
            check=False,
        )
        assert completed.returncode == 0, f"{script.name}: {completed.stderr}"


def test_directly_invoked_operation_scripts_are_executable_in_git_archive() -> None:
    relative_paths = (
        "deploy/scripts/backup_db.sh",
        "deploy/scripts/rehearse_clean_deploy.sh",
        "deploy/scripts/restore_db.sh",
        "deploy/scripts/smoke.sh",
        "deploy/scripts/status_demo_stack.sh",
        "deploy/scripts/update_demo_stack.sh",
    )
    completed = subprocess.run(
        ["git", "ls-files", "--stage", "--", *relative_paths],
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        check=True,
    )
    modes = {
        line.split(maxsplit=3)[3]: line.split(maxsplit=1)[0]
        for line in completed.stdout.splitlines()
    }

    assert modes == {path: "100755" for path in relative_paths}


def test_demo_update_fetches_advertised_refs_before_verifying_exact_sha(
    tmp_path: Path,
) -> None:
    approved_sha = "a" * 40
    temporary_root = tmp_path / "demo-checkout"
    script = temporary_root / "deploy/scripts/update_demo_stack.sh"
    script.parent.mkdir(parents=True)
    shutil.copy2(UPDATE_DEMO, script)
    (temporary_root / "deploy/env").mkdir()
    (temporary_root / "deploy/env/demo.env").write_text(
        "POSTGRES_DB=synthetic\n",
        encoding="utf-8",
    )
    (temporary_root / "deploy/compose.demo.yaml").write_text(
        "services: {}\n",
        encoding="utf-8",
    )

    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    git_log = tmp_path / "git.log"
    fake_git = fake_bin / "git"
    fake_git.write_text(
        """#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FAKE_GIT_LOG"
case "$*" in
  *"status --porcelain") exit 0 ;;
  *"fetch --no-tags origin +refs/heads/*:refs/remotes/origin/*") exit 0 ;;
  *"cat-file -e "*"^{commit}") exit 0 ;;
  *"rev-parse "*"^{commit}") printf '%s\\n' "$APPROVED_SHA"; exit 0 ;;
  *"switch --detach "*) exit 0 ;;
esac
exit 2
""",
        encoding="utf-8",
    )
    fake_git.chmod(0o755)
    fake_docker = fake_bin / "docker"
    fake_docker.write_text("#!/usr/bin/env bash\nexit 0\n", encoding="utf-8")
    fake_docker.chmod(0o755)
    env = dict(os.environ)
    env.update(
        {
            "PATH": f"{fake_bin}{os.pathsep}{env['PATH']}",
            "FAKE_GIT_LOG": str(git_log),
            "APPROVED_SHA": approved_sha,
        }
    )

    result = _run_bash(script, "--ref", approved_sha, env=env)

    assert result.returncode == 0, result.stderr
    commands = git_log.read_text(encoding="utf-8").splitlines()
    assert any(
        command.endswith(
            "fetch --no-tags origin +refs/heads/*:refs/remotes/origin/*"
        )
        for command in commands
    )
    assert not any(command.endswith(f"fetch --no-tags origin {approved_sha}") for command in commands)
    assert any(command.endswith(f"cat-file -e {approved_sha}^{{commit}}") for command in commands)
    assert any(command.endswith(f"rev-parse {approved_sha}^{{commit}}") for command in commands)


def test_ci_uses_current_postgresql_and_operations_contract() -> None:
    workflow = (REPO_ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")

    assert "bootstrap_runtime.py" not in workflow
    assert "sqlite:" not in workflow.casefold()
    assert "test_operations_contract.py" in workflow
    assert "test_demo_dataset_validation.py" in workflow
    assert "deploy/compose.demo.yaml" in workflow


def test_git_and_docker_contexts_fail_closed_for_local_env_and_secret_files() -> None:
    ignored_fixtures = (
        ".env.local",
        ".env.production",
        "backend/nested/private.env",
        "frontend/nested/.env.production",
        "deploy/nginx/tls/server.key",
        "backend/config/credentials.json",
        "frontend/config/rehearsal-secret.txt",
    )
    completed = subprocess.run(
        ["git", "check-ignore", "--no-index", "--stdin"],
        cwd=REPO_ROOT,
        input="\n".join(ignored_fixtures) + "\n",
        text=True,
        capture_output=True,
        check=False,
    )
    assert completed.returncode == 0
    assert set(completed.stdout.splitlines()) == set(ignored_fixtures)

    allowed_examples = (
        "backend/.env.example",
        "frontend/nested/test.env.example",
        "deploy/env/demo.env.example",
    )
    for path in allowed_examples:
        result = subprocess.run(
            ["git", "check-ignore", "--no-index", path],
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        assert result.returncode == 1, f"{path} unexpectedly ignored by {result.stdout}"

    required_patterns = {
        ".env",
        ".env.*",
        "*.env",
        "*.env.*",
        "!*.env.example",
        "!**/*.env.example",
        "*.pem",
        "*.key",
        "*credentials*",
        "*secret*",
        "*password*",
        "._*",
    }
    for relative_path in (
        "backend/.dockerignore",
        "frontend/.dockerignore",
        "deploy/nginx/.dockerignore",
    ):
        patterns = (REPO_ROOT / relative_path).read_text(encoding="utf-8").splitlines()
        assert required_patterns <= set(patterns), relative_path


def test_source_preparation_scans_actual_nested_fixture_and_redacts_paths(
    tmp_path: Path,
) -> None:
    safe_example = tmp_path / "nested" / "demo.env.example"
    safe_example.parent.mkdir()
    safe_example.write_text("SAFE=placeholder\n", encoding="utf-8")
    for relative_path in (
        ".env.local",
        "nested/.env.production",
        "nested/private.env",
        "nested/server.key",
        "nested/credentials.json",
        "nested/rehearsal-secret.txt",
        "nested/._metadata",
    ):
        path = tmp_path / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("not-a-real-secret\n", encoding="utf-8")

    completed = subprocess.run(
        ["python3", str(SOURCE_SCANNER), "--root", str(tmp_path)],
        text=True,
        capture_output=True,
        check=True,
    )

    assert completed.stdout.strip() == (
        '{"appledouble_files": 1, "real_env_files": 3, "secret_like_files": 3}'
    )
    assert str(tmp_path) not in completed.stdout


def test_rehearsal_builds_from_sanitized_temporary_source_context() -> None:
    source = REHEARSAL.read_text(encoding="utf-8")

    assert 'SOURCE_HEAD="$(git -C "${ROOT_DIR}" rev-parse HEAD)"' in source
    assert 'git -C "${ROOT_DIR}" archive --format=tar "${SOURCE_HEAD}"' in source
    assert 'git -C "${ROOT_DIR}" status --porcelain' in source
    assert (
        'WORK_DIR="$(mktemp -d '
        '"${TMPDIR:-/tmp}/newscast-product-reset-eval.XXXXXX")"' in source
    )
    assert 'SOURCE_ROOT="${WORK_DIR}/source"' in source
    assert 'COMPOSE_FILE="${SOURCE_ROOT}/deploy/compose.demo.yaml"' in source
    assert "real_env_files=${REAL_ENV_COUNT}" in source
    assert "secret_like_files=${SECRET_FILE_COUNT}" in source
    assert "real_env_files=0" not in source
    assert "Sanitized build context still contains AppleDouble metadata" in source
    assert "Sanitized build context contains environment or secret-like files" in source


def test_rehearsal_exercises_canonical_demo_compose_not_local_dev_compose() -> None:
    source = REHEARSAL.read_text(encoding="utf-8")

    assert 'COMPOSE_FILE="${SOURCE_ROOT}/deploy/compose.demo.yaml"' in source
    assert 'COMPOSE_FILE="${SOURCE_ROOT}/compose.yaml"' not in source


def test_rehearsal_uses_explicit_alembic_configuration_inside_container() -> None:
    source = REHEARSAL.read_text(encoding="utf-8")

    assert "alembic -c /app/alembic.ini upgrade head" in source


def test_rehearsal_keeps_production_runtime_security_guards_enabled() -> None:
    source = REHEARSAL.read_text(encoding="utf-8")

    assert "SESSION_COOKIE_SECURE=true" in source
    assert "CORS_ORIGINS=https://demo.invalid,null" in source
    assert "SESSION_COOKIE_SECURE=false" not in source
    assert (
        "run --rm -e ENVIRONMENT=development backend python scripts/seed_demo.py"
        in source
    )
    assert "UPDATE users SET is_active = false" in source
    assert "secrets.token_urlsafe(32)" in source
    assert "manage_users.py set-password astra" in source
    assert "manage_users.py activate astra" in source
    assert "SMOKE_USERNAME=astra" in source


def test_loopback_smoke_replays_secure_cookie_explicitly() -> None:
    source = (SCRIPTS_ROOT / "smoke.sh").read_text(encoding="utf-8")

    assert 'AUTH_COOKIE="$(' in source
    assert '--cookie "${AUTH_COOKIE}"' in source


def test_frontend_nginx_revalidates_html_and_immutably_caches_assets() -> None:
    config = (REPO_ROOT / "frontend/nginx.prod.conf").read_text(encoding="utf-8")

    assert "location = /index.html" in config
    assert 'Cache-Control "no-cache, must-revalidate"' in config
    assert "location /assets/" in config
    assert 'Cache-Control "public, max-age=31536000, immutable"' in config
    assert "try_files $uri =404;" in config


def test_exact_ext1_smoke_command_uses_canonical_demo_defaults(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    scripts = repo / "deploy" / "scripts"
    env_dir = repo / "deploy" / "env"
    scripts.mkdir(parents=True)
    env_dir.mkdir(parents=True)
    smoke = scripts / "smoke.sh"
    shutil.copy2(SCRIPTS_ROOT / "smoke.sh", smoke)
    compose = repo / "deploy" / "compose.demo.yaml"
    compose.write_text(
        "name: newscast_navigator_demo\nservices:\n  gateway:\n    image: synthetic\n",
        encoding="utf-8",
    )
    env_file = env_dir / "demo.env"
    env_file.write_text(
        "DEMO_BIND_HOST=127.0.0.1\nDEMO_HTTP_PORT=18443\n",
        encoding="utf-8",
    )
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    docker_log = tmp_path / "docker.log"
    docker = fake_bin / "docker"
    docker.write_text(
        """#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FAKE_DOCKER_LOG"
printf '127.0.0.1:18443\\n'
""",
        encoding="utf-8",
    )
    docker.chmod(0o755)
    curl = fake_bin / "curl"
    curl.write_text(
        """#!/usr/bin/env bash
set -euo pipefail
output=""
headers=""
url=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    --dump-header) headers="$2"; shift 2 ;;
    --write-out) shift 2 ;;
    --*) shift ;;
    *) url="$1"; shift ;;
  esac
done
case "$url" in
  */api/health) printf '{"status":"ok"}' > "$output"; printf '200' ;;
  */api/v1/auth/me) printf '{}' > "$output"; printf '401' ;;
  */assets/app-abc123.js)
    printf 'console.log("synthetic");' > "$output"
    printf 'cAcHe-CoNtRoL: PUBLIC, MAX-AGE=31536000, IMMUTABLE\\r\\n' > "$headers"
    printf '200'
    ;;
  */assets/__smoke_missing_*.js)
    printf 'not found' > "$output"
    printf 'Content-Type: text/plain\\r\\n' > "$headers"
    printf '404'
    ;;
  */)
    printf '<html><script src="/assets/app-abc123.js"></script></html>' > "$output"
    printf 'CaChE-CoNtRoL: NO-CACHE, MUST-REVALIDATE\\r\\n' > "$headers"
    printf '200'
    ;;
  *) exit 9 ;;
esac
""",
        encoding="utf-8",
    )
    curl.chmod(0o755)
    env = dict(os.environ)
    env["PATH"] = f"{fake_bin}{os.pathsep}{env['PATH']}"
    env["FAKE_DOCKER_LOG"] = str(docker_log)

    result = subprocess.run(
        [str(smoke), "--compose-file", "deploy/compose.demo.yaml"],
        cwd=repo,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert '"authenticated":false' in result.stdout
    assert '"html_cache":true' in result.stdout
    assert '"asset_cache":true' in result.stdout
    assert '"missing_asset":true' in result.stdout
    docker_command = docker_log.read_text(encoding="utf-8")
    assert "--project-name newscast_navigator_demo" in docker_command
    assert f"--env-file {env_file}" in docker_command
    assert "port gateway 80" in docker_command


def test_demo_compose_name_matches_raw_ext1_exec_project() -> None:
    demo = yaml.safe_load(
        (REPO_ROOT / "deploy/compose.demo.yaml").read_text(encoding="utf-8")
    )
    smoke = (SCRIPTS_ROOT / "smoke.sh").read_text(encoding="utf-8")

    assert demo["name"] == "newscast_navigator_demo"
    assert 'PROJECT_NAME="newscast_navigator_demo"' in smoke
    assert 'ENV_FILE="${ROOT_DIR}/deploy/env/demo.env"' in smoke
    assert "SMOKE_USERNAME=" not in "\n".join(smoke.splitlines()[:12])


def test_rehearsal_uses_fresh_run_directory_and_exact_backup_path() -> None:
    source = REHEARSAL.read_text(encoding="utf-8")

    assert 'RUNS_ROOT="${ARTIFACTS}/runs"' in source
    assert 'RUN_ARTIFACTS="${RUNS_ROOT}/${RUN_ID}"' in source
    assert 'LATEST_POINTER="${ARTIFACTS}/latest-run.txt"' in source
    assert 'rm -f "${LATEST_POINTER}"' not in source
    assert '--output-file "${BACKUP_FILE}"' in source
    assert 'BACKUP_FILE="${RUN_ARTIFACTS}/backup/postgres.dump"' in source
    assert 'find "${ARTIFACTS}/backup"' not in source
    assert 'mktemp "${ARTIFACTS}/.latest-run.txt.XXXXXX"' in source
    assert source.index('git -C "${ROOT_DIR}" status --porcelain') < source.rindex(
        "\npublish_latest_pointer\n"
    )


def test_rehearsal_publishes_hashed_manifest_only_after_logs_and_cleanup() -> None:
    source = REHEARSAL.read_text(encoding="utf-8")

    assert 'MANIFEST_FILE="${RUN_ARTIFACTS}/manifest.json"' in source
    assert '"logs_validation": "passed"' in source
    assert '"cleanup": "passed"' in source
    assert "validate_rehearsal_logs" in source
    assert "assert_project_removed" in source
    for relative_path in (
        "result.json",
        "counts-before.json",
        "counts-after.json",
        "smoke-before.json",
        "smoke-after.json",
        "source-preparation.log",
        "backup/postgres.dump",
        "backup/postgres.dump.sha256",
        "application-start.log",
        "migration.log",
        "seed.log",
        "restore.log",
        "restore-application-start.log",
        "source-runtime.log",
        "restore-runtime.log",
        "cleanup.log",
    ):
        assert relative_path in source
    assert (
        'compose "${PROJECT_NAME}" logs --no-color --no-log-prefix db backend frontend gateway '
        '> "${RUN_ARTIFACTS}/source-runtime.log"'
    ) in source
    assert (
        'compose "${RESTORE_PROJECT}" logs --no-color --no-log-prefix db backend frontend gateway '
        '> "${RUN_ARTIFACTS}/restore-runtime.log"'
    ) in source
    manifest_write = source.index('MANIFEST_FILE="${RUN_ARTIFACTS}/manifest.json"')
    cleanup_check = source.rindex("assert_project_removed")
    source_cleaned = source.rindex("SOURCE_CLEANED=1")
    restore_cleaned = source.rindex("RESTORE_CLEANED=1")
    pointer_publish = source.rindex("\npublish_latest_pointer\n")
    assert cleanup_check < source_cleaned < manifest_write < pointer_publish
    assert cleanup_check < restore_cleaned < manifest_write < pointer_publish
    assert 'if [[ "${SOURCE_CLEANED}" -eq 0 ]]; then' in source
    assert 'compose "${PROJECT_NAME}" down -v --remove-orphans' in source
    assert 'if [[ "${RESTORE_CLEANED}" -eq 0 ]]; then' in source
    assert 'compose "${RESTORE_PROJECT}" down -v --remove-orphans' in source


def test_rehearsal_pointer_publish_ignores_predictable_symlink_and_is_atomic(
    tmp_path: Path,
) -> None:
    source = REHEARSAL.read_text(encoding="utf-8")
    function_source = (
        "publish_latest_pointer() {"
        + source.split("publish_latest_pointer() {", 1)[1].split("\n}\n", 1)[0]
        + "\n}"
    )
    artifacts = tmp_path / "ops"
    artifacts.mkdir()
    target = tmp_path / "attacker-target.txt"
    target.write_text("unchanged\n", encoding="utf-8")
    predictable = artifacts / "latest-run.txt.tmp"
    predictable.symlink_to(target)

    completed = subprocess.run(
        [
            "bash",
            "-c",
            function_source
            + '\nPOINTER_TEMP=""\nARTIFACTS="$1"\nLATEST_POINTER="$1/latest-run.txt"\n'
            + 'RUN_ID="safe-run"\npublish_latest_pointer\n',
            "publish-pointer-test",
            str(artifacts),
        ],
        text=True,
        capture_output=True,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
    assert target.read_text(encoding="utf-8") == "unchanged\n"
    assert predictable.is_symlink()
    pointer = artifacts / "latest-run.txt"
    assert pointer.is_file() and not pointer.is_symlink()
    assert pointer.read_text(encoding="utf-8") == "safe-run\n"
    assert not list(artifacts.glob(".latest-run.txt.*"))


@pytest.mark.parametrize(
    "failure_line",
    [
        "backend-1  | Traceback (most recent call last):\n",
        "2026-07-24 12:00:00.000 UTC [42] ERROR: database failed\n",
        "2026/07/24 12:00:00 [crit] 42#42: gateway failed\n",
        "Unhandled exception while serving request\n",
    ],
)
def test_rehearsal_log_validator_rejects_runtime_failure_formats(
    tmp_path: Path,
    failure_line: str,
) -> None:
    source = REHEARSAL.read_text(encoding="utf-8")
    validator_source = source.split(
        'python3 - "${RUN_ARTIFACTS}" <<\'PY\'\n',
        1,
    )[1].split("\nPY\n", 1)[0]
    log_names = (
        "docker-version.log",
        "compose-version.log",
        "build.log",
        "database-start.log",
        "migration.log",
        "seed.log",
        "application-start.log",
        "backup.log",
        "restore-database-start.log",
        "restore.log",
        "restore-application-start.log",
        "containers.log",
        "source-runtime.log",
        "restore-runtime.log",
        "cleanup.log",
    )
    for log_name in log_names:
        (tmp_path / log_name).write_text("passed\n", encoding="utf-8")
    (tmp_path / "source-runtime.log").write_text(failure_line, encoding="utf-8")

    completed = subprocess.run(
        ["python3", "-", str(tmp_path)],
        input=validator_source,
        text=True,
        capture_output=True,
        check=False,
    )

    assert completed.returncode != 0
    assert "Unhandled failure marker" in completed.stderr


def test_rehearsal_dirty_preflight_preserves_previous_latest_pointer(
    tmp_path: Path,
) -> None:
    repo = tmp_path / "repo"
    script = repo / "deploy/scripts/rehearse_clean_deploy.sh"
    script.parent.mkdir(parents=True)
    shutil.copy2(REHEARSAL, script)
    marker = repo / "tracked.txt"
    marker.write_text("clean\n", encoding="utf-8")
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    subprocess.run(["git", "add", "."], cwd=repo, check=True)
    subprocess.run(
        [
            "git",
            "-c",
            "user.name=Product Reset Test",
            "-c",
            "user.email=product-reset@example.invalid",
            "commit",
            "-qm",
            "fixture",
        ],
        cwd=repo,
        check=True,
    )
    artifacts = repo / "artifacts/product-reset/CP7/ops"
    artifacts.mkdir(parents=True)
    pointer = artifacts / "latest-run.txt"
    pointer.write_text("previous-valid-run\n", encoding="utf-8")
    marker.write_text("dirty\n", encoding="utf-8")

    result = subprocess.run(
        [
            "bash",
            str(script),
            "--project-name",
            "nn-product-reset-eval-pointer-test",
            "--artifacts",
            str(artifacts),
        ],
        cwd=repo,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode != 0
    assert "clean exact committed HEAD" in result.stderr
    assert pointer.read_text(encoding="utf-8") == "previous-valid-run\n"
