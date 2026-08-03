from __future__ import annotations

from sqlalchemy.dialects import postgresql

from app.core.security import create_session_token, verify_session_token
from app.db.models import User
from app.services.auth_service import credential_user_lock_statement


def test_credential_user_lock_uses_the_same_postgresql_row_lock_for_id_and_username() -> None:
    by_id = credential_user_lock_statement(user_id=17)
    by_username = credential_user_lock_statement(username="synthetic-user")

    assert by_id._for_update_arg is not None
    assert by_username._for_update_arg is not None
    assert "FROM users" in str(by_id.compile(dialect=postgresql.dialect()))
    assert "users.id =" in str(by_id.compile(dialect=postgresql.dialect()))
    assert "FOR UPDATE" in str(by_id.compile(dialect=postgresql.dialect()))
    assert "users.username =" in str(by_username.compile(dialect=postgresql.dialect()))
    assert "FOR UPDATE" in str(by_username.compile(dialect=postgresql.dialect()))


def test_credential_user_lock_requires_exactly_one_lookup_key() -> None:
    for payload in ({}, {"user_id": 1, "username": "synthetic-user"}):
        try:
            credential_user_lock_statement(**payload)
        except ValueError as exc:
            assert str(exc) == "Exactly one credential user lookup key is required"
        else:
            raise AssertionError("Ambiguous credential lock lookup must fail closed")

    assert credential_user_lock_statement(user_id=1).column_descriptions[0]["entity"] is User


def test_session_tokens_distinguish_browser_and_captionpanels_purposes() -> None:
    browser_claims = verify_session_token(create_session_token(17, "browser-session"))
    captionpanels_claims = verify_session_token(
        create_session_token(17, "captionpanels-session", purpose="captionpanels")
    )

    assert browser_claims is not None
    assert browser_claims.purpose == "browser"
    assert captionpanels_claims is not None
    assert captionpanels_claims.purpose == "captionpanels"
