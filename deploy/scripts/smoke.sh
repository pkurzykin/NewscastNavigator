#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CANONICAL_COMPOSE_FILE="${ROOT_DIR}/deploy/compose.demo.yaml"
COMPOSE_FILE="${CANONICAL_COMPOSE_FILE}"
ENV_FILE="${ROOT_DIR}/deploy/env/demo.env"
PROJECT_NAME="newscast_navigator_demo"
BASE_URL=""
ENV_FILE_EXPLICIT=0

usage() {
  echo "Usage: $0 [--project-name NAME] [--compose-file FILE] [--env-file FILE] [--base-url URL]" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-name) PROJECT_NAME="${2:-}"; shift 2 ;;
    --compose-file) COMPOSE_FILE="${2:-}"; shift 2 ;;
    --env-file) ENV_FILE="${2:-}"; ENV_FILE_EXPLICIT=1; shift 2 ;;
    --base-url) BASE_URL="${2:-}"; shift 2 ;;
    *) usage; exit 2 ;;
  esac
done

COMPOSE_FILE="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "${COMPOSE_FILE}")"
ENV_FILE="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "${ENV_FILE}")"

if [[ -z "${PROJECT_NAME}" || ! "${PROJECT_NAME}" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]]; then
  echo "Valid Compose project name is required" >&2
  exit 2
fi
if [[ "${ENV_FILE_EXPLICIT}" -eq 0 && "${COMPOSE_FILE}" != "${CANONICAL_COMPOSE_FILE}" ]]; then
  echo "A non-canonical Compose file requires an explicit env file" >&2
  exit 2
fi
if [[ ! -f "${COMPOSE_FILE}" || ! -f "${ENV_FILE}" ]]; then
  echo "Compose or env file not found" >&2
  exit 2
fi
if [[ -z "${BASE_URL}" ]]; then
  PUBLISHED_ENDPOINT="$(
    docker compose \
      --project-name "${PROJECT_NAME}" \
      --env-file "${ENV_FILE}" \
      -f "${COMPOSE_FILE}" \
      port gateway 80 |
      head -n 1
  )"
  PUBLISHED_PORT="${PUBLISHED_ENDPOINT##*:}"
  if [[ ! "${PUBLISHED_PORT}" =~ ^[0-9]+$ ]]; then
    echo "Could not discover the local demo gateway port" >&2
    exit 2
  fi
  BASE_URL="http://127.0.0.1:${PUBLISHED_PORT}"
fi
if [[ ! "${BASE_URL}" =~ ^http://(127\.0\.0\.1|localhost):[0-9]+$ ]]; then
  echo "Smoke base URL must use local loopback HTTP" >&2
  exit 2
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

request_status() {
  local body_file="$1"
  local headers_file="$2"
  local url="$3"
  shift 3
  curl --silent --show-error \
    --output "${body_file}" \
    --dump-header "${headers_file}" \
    --write-out "%{http_code}" \
    "$@" \
    "${url}"
}

require_cache_control() {
  local headers_file="$1"
  local expected="$2"
  local label="$3"

  if ! python3 - "${headers_file}" "${expected}" <<'PY'
import sys
from pathlib import Path

headers = Path(sys.argv[1]).read_text(encoding="iso-8859-1")
expected = {
    directive.strip().casefold()
    for directive in sys.argv[2].split(",")
    if directive.strip()
}
actual: set[str] = set()
for line in headers.splitlines():
    name, separator, value = line.partition(":")
    if separator and name.strip().casefold() == "cache-control":
        actual.update(
            directive.strip().casefold()
            for directive in value.split(",")
            if directive.strip()
        )
raise SystemExit(0 if actual == expected else 1)
PY
  then
    echo "Smoke failed: ${label} Cache-Control policy is missing or unexpected" >&2
    exit 1
  fi
}

extract_hashed_asset() {
  python3 - "${TMP_DIR}/root.html" <<'PY'
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit


class AssetScriptParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.asset: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.casefold() != "script" or self.asset is not None:
            return
        src = dict(attrs).get("src")
        if not src:
            return
        parsed = urlsplit(src)
        if parsed.scheme or parsed.netloc or parsed.query or parsed.fragment:
            return
        if re.fullmatch(
            r"/assets/[A-Za-z0-9][A-Za-z0-9._-]*-[A-Za-z0-9_-]{6,}\.js",
            parsed.path,
        ):
            self.asset = parsed.path


parser = AssetScriptParser()
parser.feed(Path(sys.argv[1]).read_text(encoding="utf-8"))
if parser.asset is None:
    raise SystemExit(1)
print(parser.asset)
PY
}

require_not_html() {
  local body_file="$1"
  local headers_file="$2"
  if ! python3 - "${body_file}" "${headers_file}" <<'PY'
import sys
from html.parser import HTMLParser
from pathlib import Path

body = Path(sys.argv[1]).read_bytes().decode("utf-8", errors="replace").casefold()
headers = Path(sys.argv[2]).read_text(encoding="iso-8859-1")
for line in headers.splitlines():
    name, separator, value = line.partition(":")
    media_type = value.partition(";")[0].strip().casefold()
    if separator and name.strip().casefold() == "content-type" and media_type == "text/html":
        raise SystemExit(1)


class MarkupDetector(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.found = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.found = True

    def handle_startendtag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        self.found = True

    def handle_endtag(self, tag: str) -> None:
        self.found = True

    def handle_decl(self, decl: str) -> None:
        self.found = True


parser = MarkupDetector()
parser.feed(body)
if parser.found:
    raise SystemExit(1)
PY
  then
    echo "Smoke failed: missing asset returned HTML" >&2
    exit 1
  fi
}

HEALTH_STATUS="$(request_status "${TMP_DIR}/health.json" "${TMP_DIR}/health.headers" "${BASE_URL}/api/health")"
ROOT_STATUS="$(request_status "${TMP_DIR}/root.html" "${TMP_DIR}/root.headers" "${BASE_URL}/")"
AUTH_STATUS="$(request_status "${TMP_DIR}/auth.json" "${TMP_DIR}/auth.headers" "${BASE_URL}/api/v1/auth/me")"

if [[ "${HEALTH_STATUS}" != "200" || "${ROOT_STATUS}" != "200" || "${AUTH_STATUS}" != "401" ]]; then
  echo "Smoke failed: health=${HEALTH_STATUS} root=${ROOT_STATUS} unauthenticated=${AUTH_STATUS}" >&2
  exit 1
fi
require_cache_control "${TMP_DIR}/root.headers" "no-cache, must-revalidate" "HTML"
HASHED_ASSET="$(extract_hashed_asset)" || {
  echo "Smoke failed: no safe hashed JavaScript asset found in HTML" >&2
  exit 1
}
ASSET_STATUS="$(request_status "${TMP_DIR}/asset.js" "${TMP_DIR}/asset.headers" "${BASE_URL}${HASHED_ASSET}")"
if [[ "${ASSET_STATUS}" != "200" ]]; then
  echo "Smoke failed: hashed asset=${ASSET_STATUS}" >&2
  exit 1
fi
require_cache_control "${TMP_DIR}/asset.headers" "public, max-age=31536000, immutable" "hashed asset"
MISSING_ASSET_PATH="/assets/__smoke_missing_$(basename "$(mktemp "${TMP_DIR}/asset.XXXXXX")").js"
MISSING_ASSET_STATUS="$(request_status "${TMP_DIR}/missing-asset.txt" "${TMP_DIR}/missing-asset.headers" "${BASE_URL}${MISSING_ASSET_PATH}")"
if [[ "${MISSING_ASSET_STATUS}" != "404" ]]; then
  echo "Smoke failed: missing asset=${MISSING_ASSET_STATUS}" >&2
  exit 1
fi
require_not_html "${TMP_DIR}/missing-asset.txt" "${TMP_DIR}/missing-asset.headers"
python3 - "${TMP_DIR}/health.json" <<'PY'
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
if payload != {"status": "ok"}:
    raise SystemExit("Unexpected health payload")
PY

if [[ -n "${SMOKE_USERNAME:-}" || -n "${SMOKE_PASSWORD:-}" ]]; then
  if [[ -z "${SMOKE_USERNAME:-}" || -z "${SMOKE_PASSWORD:-}" ]]; then
    echo "Both SMOKE_USERNAME and SMOKE_PASSWORD are required" >&2
    exit 2
  fi
  LOGIN_PAYLOAD="$(
    SMOKE_USERNAME="${SMOKE_USERNAME}" SMOKE_PASSWORD="${SMOKE_PASSWORD}" python3 <<'PY'
import json
import os
print(json.dumps({
    "username": os.environ["SMOKE_USERNAME"],
    "password": os.environ["SMOKE_PASSWORD"],
}, ensure_ascii=False))
PY
  )"
  LOGIN_STATUS="$(
    request_status \
      "${TMP_DIR}/login.json" \
      "${TMP_DIR}/login.headers" \
      "${BASE_URL}/api/v1/auth/login" \
      --cookie-jar "${TMP_DIR}/cookies.txt" \
      --header "Content-Type: application/json" \
      --data-binary "${LOGIN_PAYLOAD}"
  )"
  AUTH_COOKIE="$(
    awk 'NF >= 7 && $6 != "" {print $6 "=" $7}' "${TMP_DIR}/cookies.txt" |
      tail -n 1
  )"
  if [[ -z "${AUTH_COOKIE}" ]]; then
    echo "Authenticated smoke failed: login did not return a session cookie" >&2
    exit 1
  fi
  STORIES_STATUS="$(
    request_status \
      "${TMP_DIR}/stories.json" \
      "${TMP_DIR}/stories.headers" \
      "${BASE_URL}/api/v1/stories?lifecycle=active&limit=1" \
      --cookie "${AUTH_COOKIE}"
  )"
  if [[ "${LOGIN_STATUS}" != "200" || "${STORIES_STATUS}" != "200" ]]; then
    echo "Authenticated smoke failed: login=${LOGIN_STATUS} stories=${STORIES_STATUS}" >&2
    exit 1
  fi
fi

printf '{"health":200,"root":200,"unauthenticated":401,"html_cache":true,"asset_cache":true,"missing_asset":true,"authenticated":%s}\n' \
  "$([[ -n "${SMOKE_USERNAME:-}" ]] && printf 'true' || printf 'false')"
