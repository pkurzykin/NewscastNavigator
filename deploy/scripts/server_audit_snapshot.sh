#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT_ROOT="${1:-${ROOT_DIR}/deploy/audit-snapshots}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUTPUT_DIR="${OUTPUT_ROOT}/server-audit-${TIMESTAMP}"

mkdir -p "${OUTPUT_DIR}"

run_capture() {
  local name="$1"
  shift

  {
    echo "# Command"
    printf '%q ' "$@"
    echo
    echo
    "$@"
  } > "${OUTPUT_DIR}/${name}.txt" 2>&1 || true
}

run_shell_capture() {
  local name="$1"
  local cmd="$2"

  {
    echo "# Command"
    echo "${cmd}"
    echo
    /bin/sh -lc "${cmd}"
  } > "${OUTPUT_DIR}/${name}.txt" 2>&1 || true
}

run_shell_capture "00_basic" "date; echo; hostname; echo; whoami; echo; pwd; echo; uname -a"
run_shell_capture "10_git_status" "git status -sb 2>/dev/null || true; echo; git rev-parse --short HEAD 2>/dev/null || true"
run_shell_capture "20_docker_ps" "docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}' 2>/dev/null || true"
run_shell_capture "21_docker_compose_ls" "docker compose ls 2>/dev/null || true"
run_shell_capture "22_docker_volume_ls" "docker volume ls 2>/dev/null || true"
run_shell_capture "30_systemd_units" "systemctl list-units --type=service 2>/dev/null | grep -Ei 'newscast|docker|nginx' || true"
run_shell_capture "40_listening_ports" "ss -tulpn 2>/dev/null | grep -E ':80|:443|:5173|:8000|:8100|:8088|:5432|:5433' || true"
run_shell_capture "50_nginx_test" "nginx -T 2>/dev/null || true"
run_shell_capture "60_processes" "ps aux | grep -Ei 'newscast|nginx|docker|uvicorn|vite|node' | grep -v grep || true"

cat > "${OUTPUT_DIR}/README.txt" <<EOF
Server audit snapshot

Created: $(date)
Output dir: ${OUTPUT_DIR}

This snapshot is read-only and intended for deploy planning.
Review at least:
- 10_git_status.txt
- 20_docker_ps.txt
- 21_docker_compose_ls.txt
- 22_docker_volume_ls.txt
- 30_systemd_units.txt
- 40_listening_ports.txt
- 50_nginx_test.txt
EOF

echo "Server audit snapshot created: ${OUTPUT_DIR}"
