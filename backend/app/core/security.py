from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time

from app.core.config import get_settings


PBKDF2_ALGORITHM = "sha256"
PBKDF2_ITERATIONS = 390_000


def hash_password(raw_password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        PBKDF2_ALGORITHM,
        raw_password.encode("utf-8"),
        salt,
        PBKDF2_ITERATIONS,
    )
    salt_b64 = base64.urlsafe_b64encode(salt).decode("ascii")
    digest_b64 = base64.urlsafe_b64encode(digest).decode("ascii")
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt_b64}${digest_b64}"


def verify_password(raw_password: str, hashed_password: str) -> bool:
    try:
        scheme, iterations_raw, salt_b64, digest_b64 = hashed_password.split("$", 3)
    except ValueError:
        return False

    if scheme != "pbkdf2_sha256":
        return False

    try:
        iterations = int(iterations_raw)
        salt = base64.urlsafe_b64decode(salt_b64.encode("ascii"))
        expected_digest = base64.urlsafe_b64decode(digest_b64.encode("ascii"))
    except Exception:
        return False

    candidate_digest = hashlib.pbkdf2_hmac(
        PBKDF2_ALGORITHM,
        raw_password.encode("utf-8"),
        salt,
        iterations,
    )
    return hmac.compare_digest(candidate_digest, expected_digest)


def create_session_token(user_id: int) -> str:
    now_ts = int(time.time())
    payload = {
        "uid": int(user_id),
        "iat": now_ts,
        "exp": now_ts + int(get_settings().session_token_ttl_seconds),
    }
    payload_json = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    signature = hmac.new(
        get_settings().session_secret.encode("utf-8"),
        payload_json.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    token_bytes = f"{payload_json}.{signature}".encode("utf-8")
    return base64.urlsafe_b64encode(token_bytes).decode("ascii")


def verify_session_token(token: str) -> int | None:
    if not token:
        return None

    try:
        decoded = base64.urlsafe_b64decode(token.encode("ascii")).decode("utf-8")
        payload_json, signature = decoded.rsplit(".", 1)
    except Exception:
        return None

    expected_signature = hmac.new(
        get_settings().session_secret.encode("utf-8"),
        payload_json.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected_signature, signature):
        return None

    try:
        payload = json.loads(payload_json)
        user_id = int(payload["uid"])
        exp = int(payload["exp"])
    except Exception:
        return None

    if exp < int(time.time()):
        return None

    return user_id
