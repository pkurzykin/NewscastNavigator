"""Watch the VDS and the last verified home DB point from the home server."""

import argparse
import fcntl
import http.client
import json
import os
from pathlib import Path
import socket
import ssl
import tempfile
import time

from alert_mail import load_config, send_event


RETRY_AFTER = {"site": 3600, "backup": 3600, "cert": 86400, "retention": 86400}
FAILURES_NEEDED = {"site": 2, "backup": 1, "cert": 1, "retention": 1}
BACKUP_MAX_AGE = 900
VERIFY_MAX_AGE = 600
CERT_WARN_AGE = 30 * 86400
ARMED_PATH = Path("/home/newscast/private-demo/hostland-backups/monitor/cutover-active")
RETENTION_ARMED_PATH = Path("/home/newscast/private-demo/hostland-backups/monitor/retention-active")
RETENTION_STATUS_PATH = Path("/home/newscast/private-demo/hostland-backups/monitor/retention-status.json")


def is_armed(path: Path, expected: str = "monitor-enabled\n") -> bool:
    """Require a deliberate, private on-host marker before any alert run."""
    try:
        if path.is_symlink() or not path.is_file():
            return False
        metadata = path.stat()
        return (metadata.st_uid == os.geteuid() and metadata.st_mode & 0o077 == 0
                and path.read_text() == expected)
    except OSError:
        return False


def _write_state(path: Path, state: dict) -> None:
    if path.is_symlink() or path.parent.is_symlink():
        raise ValueError("Unsafe monitor state path")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".state-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(state, stream, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def apply_observations(path: Path, observations: dict[str, tuple[bool, str]],
                       now: int, send) -> None:
    if path.is_symlink():
        raise ValueError("Unsafe monitor state path")
    state = json.loads(path.read_text()) if path.exists() else {}
    if not isinstance(state, dict):
        raise ValueError("Invalid monitor state")
    for kind, (healthy, detail) in observations.items():
        if kind not in RETRY_AFTER or type(healthy) is not bool:
            raise ValueError("Invalid monitor observation")
        item = state.get(kind, {"failures": 0, "active": False, "last_sent": 0})
        if healthy:
            if item["active"]:
                send(kind, "recovery", detail)
                item["active"] = False
                item["last_sent"] = now
            item["failures"] = 0
        else:
            item["failures"] = min(int(item["failures"]) + 1, FAILURES_NEEDED[kind])
            due = not item["active"] or now - int(item["last_sent"]) >= RETRY_AFTER[kind]
            if item["failures"] >= FAILURES_NEEDED[kind] and due:
                status = "reminder" if item["active"] else "alert"
                send(kind, status, detail)
                item["active"] = True
                item["last_sent"] = now
        state[kind] = item
        _write_state(path, state)


def check_backup(marker: Path, *, now: int | None = None) -> tuple[bool, str]:
    current = int(time.time() if now is None else now)
    if marker.is_symlink() or not marker.is_file():
        return False, "Нет отметки о проверенной домашней копии"
    try:
        evidence = json.loads(marker.read_text())
        db_age = current - int(evidence["db_created_unix"])
        verified_age = current - int(evidence["verified_unix"])
        if db_age < 0 or verified_age < 0:
            return False, "Некорректное время резервной копии"
        if db_age > BACKUP_MAX_AGE or verified_age > VERIFY_MAX_AGE:
            return False, f"DB age={db_age}s, проверка дома age={verified_age}s"
        return True, f"DB age={db_age}s, проверка дома age={verified_age}s"
    except (OSError, ValueError, KeyError, TypeError):
        return False, "Некорректная отметка о проверенной домашней копии"


def check_retention(status: Path, *, now: int | None = None) -> tuple[bool, str]:
    current = int(time.time() if now is None else now)
    if status.is_symlink() or not status.is_file():
        return False, "Нет результата автоматической очистки"
    try:
        evidence = json.loads(status.read_text())
        attempted = evidence["last_attempt_unix"]
        successful = evidence["last_success_unix"]
        if type(attempted) is not int or type(successful) is not int:
            raise ValueError("Invalid retention timestamp")
        age = current - attempted
        if age < 0 or age > 36 * 3600:
            return False, "Автоматическая очистка не завершалась более 36 часов"
        if evidence["status"] != "ok" or successful != attempted:
            return False, "Автоматическая очистка завершилась ошибкой"
        return True, "Проверка срока хранения прошла"
    except (OSError, ValueError, KeyError, TypeError):
        return False, "Некорректный результат автоматической очистки"


def _https_request(ip: str, host: str, path: str) -> tuple[int, dict, bytes, dict]:
    connection = http.client.HTTPSConnection(host, 443, timeout=8, context=ssl.create_default_context())
    connection._create_connection = lambda address, timeout, source_address=None: socket.create_connection((ip, 443), timeout)
    try:
        connection.connect()
        certificate = connection.sock.getpeercert()
        connection.request("GET", path, headers={"Host": host, "Connection": "close"})
        response = connection.getresponse()
        return response.status, dict(response.getheaders()), response.read(4096), certificate
    finally:
        connection.close()


def _check_certificate(ip: str, *, now: int) -> tuple[bool, str] | None:
    try:
        with socket.create_connection((ip, 443), timeout=8) as connection:
            with ssl.create_default_context().wrap_socket(connection, server_hostname="ncastnav.ru") as secure:
                certificate = secure.getpeercert()
        expires = ssl.cert_time_to_seconds(certificate["notAfter"])
        remaining = expires - now
        return remaining > CERT_WARN_AGE, f"Сертификат: осталось {remaining // 86400} дн."
    except ssl.SSLCertVerificationError as exc:
        return False, f"Проверка TLS-сертификата не прошла: {type(exc).__name__}"
    except (OSError, ssl.SSLError, ValueError, KeyError):
        return None


def check_site(ip: str, *, now: int | None = None) -> tuple[tuple[bool, str], tuple[bool, str] | None]:
    current = int(time.time() if now is None else now)
    cert = _check_certificate(ip, now=current)
    try:
        health_status, _, health_body, _ = _https_request(ip, "ncastnav.ru", "/api/health")
        health = json.loads(health_body)
        if health_status != 200 or not isinstance(health, dict) or health.get("status") != "ok":
            return (False, f"api/health HTTP {health_status}"), cert
        page_status, page_headers, _, _ = _https_request(ip, "www.ncastnav.ru", "/")
        page_headers = {key.lower(): value for key, value in page_headers.items()}
        if page_status != 200 or "text/html" not in page_headers.get("content-type", ""):
            return (False, f"www HTTP {page_status}"), cert
        return (True, "HTTPS и API доступны"), cert
    except (OSError, ssl.SSLError, ValueError, KeyError, TypeError,
            http.client.HTTPException, json.JSONDecodeError) as exc:
        return (False, f"HTTPS проверка не прошла: {type(exc).__name__}"), cert


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True, type=Path)
    args = parser.parse_args()
    try:
        if not is_armed(ARMED_PATH):
            raise ValueError("Monitor is not armed")
        config = load_config(args.config)
        if config.get("vds_ip") != "185.221.215.76":
            raise ValueError("Unexpected VDS address")
        marker = Path(config["backup_marker"])
        state = Path(config["state_file"])
        lock = Path(config["lock_file"])
        if any(not path.is_absolute() for path in (marker, state, lock)):
            raise ValueError("Monitor paths must be absolute")
        lock.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with lock.open("w") as stream:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            site, cert = check_site(config["vds_ip"])
            observations = {"site": site, "backup": check_backup(marker)}
            if cert is not None:
                observations["cert"] = cert
            if is_armed(RETENTION_ARMED_PATH, "retention-enabled\n"):
                observations["retention"] = check_retention(RETENTION_STATUS_PATH)
            apply_observations(state, observations, int(time.time()),
                               lambda kind, status, detail: send_event(config, kind, status, detail))
            for kind, (healthy, _) in observations.items():
                print(f"MONITOR_{kind.upper()}={'ok' if healthy else 'fail'}")
    except Exception:
        print("HOME_MONITOR_FAILED")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
