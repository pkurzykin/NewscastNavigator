from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import datetime
import hashlib
import hmac
import json
import secrets
import time

from app.core.config import get_settings


PBKDF2_ALGORITHM = "sha256"
PBKDF2_ITERATIONS = 390_000
BROWSER_SESSION_PURPOSE = "browser"
CAPTIONPANELS_SESSION_PURPOSE = "captionpanels"
SESSION_TOKEN_PURPOSES = frozenset(
    {BROWSER_SESSION_PURPOSE, CAPTIONPANELS_SESSION_PURPOSE}
)


@dataclass(frozen=True)
class SessionTokenClaims:
    user_id: int
    session_id: str
    purpose: str


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


def _normalize_hash_value(hashed_password: str | bytes | None) -> str:
    if hashed_password is None:
        return ""
    if isinstance(hashed_password, bytes):
        return hashed_password.decode("utf-8", errors="ignore")
    return str(hashed_password)


def verify_password(raw_password: str, hashed_password: str | bytes | None) -> bool:
    normalized_hash = _normalize_hash_value(hashed_password)
    try:
        scheme, iterations_raw, salt_b64, digest_b64 = normalized_hash.split("$", 3)
    except ValueError:
        return False

    if scheme != "pbkdf2_sha256" or iterations_raw != str(PBKDF2_ITERATIONS):
        return False

    try:
        iterations = int(iterations_raw)
        salt = base64.b64decode(salt_b64, altchars=b"-_", validate=True)
        expected_digest = base64.b64decode(digest_b64, altchars=b"-_", validate=True)
    except (ValueError, TypeError):
        return False

    if len(salt) != 16 or len(expected_digest) != hashlib.sha256().digest_size:
        return False

    candidate_digest = hashlib.pbkdf2_hmac(
        PBKDF2_ALGORITHM,
        raw_password.encode("utf-8"),
        salt,
        iterations,
    )
    return hmac.compare_digest(candidate_digest, expected_digest)


def create_session_token(
    user_id: int,
    session_id: str,
    *,
    expires_at: datetime | None = None,
    purpose: str = BROWSER_SESSION_PURPOSE,
) -> str:
    if purpose not in SESSION_TOKEN_PURPOSES:
        raise ValueError("Unsupported session token purpose")
    now_ts = int(time.time())
    payload = {
        "uid": int(user_id),
        "sid": str(session_id),
        "iat": now_ts,
        "exp": (
            int(expires_at.timestamp())
            if expires_at is not None
            else now_ts + int(get_settings().session_token_ttl_seconds)
        ),
    }
    if purpose != BROWSER_SESSION_PURPOSE:
        payload["purpose"] = purpose
    payload_json = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    signature = hmac.new(
        get_settings().session_secret.encode("utf-8"),
        payload_json.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    token_bytes = f"{payload_json}.{signature}".encode("utf-8")
    return base64.urlsafe_b64encode(token_bytes).decode("ascii")


def verify_session_token(token: str) -> SessionTokenClaims | None:
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
        session_id = str(payload["sid"])
        exp = int(payload["exp"])
        purpose = str(payload.get("purpose", BROWSER_SESSION_PURPOSE))
    except Exception:
        return None

    if not session_id or exp <= int(time.time()) or purpose not in SESSION_TOKEN_PURPOSES:
        return None

    return SessionTokenClaims(user_id=user_id, session_id=session_id, purpose=purpose)
