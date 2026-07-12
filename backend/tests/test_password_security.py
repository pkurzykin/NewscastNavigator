from __future__ import annotations

import base64
import re

from app.core import security


PASSWORD_HASH_PATTERN = re.compile(
    r"^pbkdf2_sha256\$390000\$[A-Za-z0-9_-]+=*\$[A-Za-z0-9_-]+=*$"
)


def test_password_hash_uses_exact_pbkdf2_contract_and_random_salt() -> None:
    first = security.hash_password("Correct-Horse-2026!")
    second = security.hash_password("Correct-Horse-2026!")

    assert PASSWORD_HASH_PATTERN.fullmatch(first)
    assert first != second
    _, iterations, salt_b64, digest_b64 = first.split("$")
    assert iterations == "390000"
    assert len(base64.urlsafe_b64decode(salt_b64)) == 16
    assert len(base64.urlsafe_b64decode(digest_b64)) == 32


def test_password_verification_uses_constant_time_digest_comparison(monkeypatch) -> None:
    encoded = security.hash_password("Correct-Horse-2026!")
    calls: list[tuple[bytes, bytes]] = []
    original = security.hmac.compare_digest

    def record(candidate: bytes, expected: bytes) -> bool:
        calls.append((candidate, expected))
        return original(candidate, expected)

    monkeypatch.setattr(security.hmac, "compare_digest", record)

    assert security.verify_password("Correct-Horse-2026!", encoded) is True
    assert calls and all(isinstance(value, bytes) for pair in calls for value in pair)


def test_password_verification_rejects_wrong_malformed_or_noncanonical_hashes() -> None:
    encoded = security.hash_password("Correct-Horse-2026!")
    assert security.verify_password("wrong", encoded) is False
    assert security.verify_password("anything", None) is False
    assert security.verify_password("anything", "") is False
    assert security.verify_password("anything", "pbkdf2_sha256$1$c2FsdA==$ZGlnaWVzdA==") is False
    assert security.verify_password("anything", "$2b$12$legacy") is False
