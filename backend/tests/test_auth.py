from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select
from types import SimpleNamespace

from app.core.security import create_session_token, hash_password
from app.db.models import User, UserFunction
from app.db.session import SessionLocal
from app.main import app


def _create_user(
    *,
    username: str,
    password: str,
    functions: tuple[str, ...],
    must_change_password: bool = False,
) -> User:
    with SessionLocal() as db:
        user = User(
            username=username,
            display_name="Астра",
            position="Сотрудник",
            password_hash=hash_password(password),
            is_active=True,
            must_change_password=must_change_password,
        )
        user.functions = [UserFunction(function_code=code) for code in functions]
        db.add(user)
        db.commit()
        db.refresh(user)
        return user


def test_login_returns_position_and_combined_functions_without_role(client) -> None:
    _create_user(
        username="combined-auth",
        password="Combined-Auth-2026!",
        functions=("author", "proofreader"),
    )

    response = client.post(
        "/api/v1/auth/login",
        json={"username": "combined-auth", "password": "Combined-Auth-2026!"},
    )

    assert response.status_code == 200
    assert "httponly" in response.headers["set-cookie"].casefold()
    assert "newscast_session=" in response.headers["set-cookie"]
    payload = response.json()
    assert "access_token" not in payload
    assert payload["user"]["display_name"] == "Астра"
    assert payload["user"]["position"] == "Сотрудник"
    assert payload["user"]["function_codes"] == ["author", "proofreader"]
    assert "role" not in payload["user"]
    assert client.get("/api/v1/auth/me").status_code == 200
    client.cookies.clear()
    bearer_only = client.get(
        "/api/v1/auth/me",
        headers={
            "Authorization": (
                f"Bearer {create_session_token(payload['user']['id'], 'bearer-only-session')}"
            )
        },
    )
    assert bearer_only.status_code == 401


def test_configured_session_cookie_name_is_used_for_login_and_auth(client, monkeypatch) -> None:
    _create_user(
        username="configured-cookie",
        password="Configured-Cookie-2026!",
        functions=("author",),
    )
    settings = SimpleNamespace(
        session_cookie_name="custom_newscast_session",
        session_cookie_secure=False,
        session_token_ttl_seconds=3600,
    )
    monkeypatch.setattr("app.api.routes.auth.get_settings", lambda: settings)
    monkeypatch.setattr("app.api.deps.get_settings", lambda: settings)

    response = client.post(
        "/api/v1/auth/login",
        json={"username": "configured-cookie", "password": "Configured-Cookie-2026!"},
    )

    assert response.status_code == 200
    assert "custom_newscast_session=" in response.headers["set-cookie"]
    assert client.get("/api/v1/auth/me").status_code == 200


def test_logout_expires_the_canonical_session_cookie(client) -> None:
    _create_user(
        username="logout-auth",
        password="Logout-Auth-2026!",
        functions=("author",),
    )
    assert client.post(
        "/api/v1/auth/login",
        json={"username": "logout-auth", "password": "Logout-Auth-2026!"},
    ).status_code == 200

    response = client.post("/api/v1/auth/logout")

    assert response.status_code == 200
    assert "newscast_session=" in response.headers["set-cookie"]
    assert "max-age=0" in response.headers["set-cookie"].casefold()
    assert client.get("/api/v1/auth/me").status_code == 401


def test_logout_revokes_saved_cookie_on_the_server(client) -> None:
    _create_user(
        username="logout-replay",
        password="Logout-Replay-2026!",
        functions=("author",),
    )
    login = client.post(
        "/api/v1/auth/login",
        json={"username": "logout-replay", "password": "Logout-Replay-2026!"},
    )
    assert login.status_code == 200
    saved_cookie = login.cookies.get("newscast_session")
    assert saved_cookie

    assert client.post("/api/v1/auth/logout").status_code == 200

    with TestClient(app) as replay_client:
        replay_client.cookies.set("newscast_session", saved_cookie)
        replay = replay_client.get("/api/v1/auth/me")
    assert replay.status_code == 401
    assert replay.json()["error"]["code"] == "AUTH_REQUIRED"


def test_logout_revokes_only_the_current_concurrent_session(client) -> None:
    _create_user(
        username="logout-concurrent",
        password="Logout-Concurrent-2026!",
        functions=("author",),
    )
    assert client.post(
        "/api/v1/auth/login",
        json={"username": "logout-concurrent", "password": "Logout-Concurrent-2026!"},
    ).status_code == 200

    with TestClient(app) as second_client:
        assert second_client.post(
            "/api/v1/auth/login",
            json={
                "username": "logout-concurrent",
                "password": "Logout-Concurrent-2026!",
            },
        ).status_code == 200

        assert client.post("/api/v1/auth/logout").status_code == 200

        assert client.get("/api/v1/auth/me").status_code == 401
        assert second_client.get("/api/v1/auth/me").status_code == 200


def test_logout_remains_idempotent_without_a_valid_cookie(client) -> None:
    assert client.post("/api/v1/auth/logout").status_code == 200
    client.cookies.set("newscast_session", "invalid-session-cookie")
    assert client.post("/api/v1/auth/logout").status_code == 200


def test_inactive_user_cannot_authenticate(client) -> None:
    user = _create_user(
        username="inactive-auth",
        password="Inactive-Auth-2026!",
        functions=("author",),
    )
    with SessionLocal() as db:
        stored = db.execute(select(User).where(User.id == user.id)).scalar_one()
        stored.is_active = False
        db.commit()

    response = client.post(
        "/api/v1/auth/login",
        json={"username": "inactive-auth", "password": "Inactive-Auth-2026!"},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"


def test_unknown_or_wrong_credentials_return_canonical_auth_error(client) -> None:
    _create_user(
        username="wrong-auth",
        password="Wrong-Auth-2026!",
        functions=("author",),
    )

    for username, password in (
        ("unknown-auth", "Wrong-Auth-2026!"),
        ("wrong-auth", "Definitely-Wrong-2026!"),
    ):
        response = client.post(
            "/api/v1/auth/login",
            json={"username": username, "password": password},
        )
        assert response.status_code == 401
        assert response.json() == {
            "error": {
                "code": "AUTH_REQUIRED",
                "message": "Неверные учетные данные",
                "details": {},
            }
        }


def test_change_password_replaces_hash_and_requires_current_password(client) -> None:
    _create_user(
        username="password-auth",
        password="Password-Auth-2026!",
        functions=("author",),
    )
    login = client.post(
        "/api/v1/auth/login",
        json={"username": "password-auth", "password": "Password-Auth-2026!"},
    )
    assert login.status_code == 200

    changed = client.post(
        "/api/v1/auth/change-password",
        json={
            "current_password": "Password-Auth-2026!",
            "new_password": "Password-Auth-Changed-2026!",
        },
    )

    assert changed.status_code == 200
    assert client.post(
        "/api/v1/auth/login",
        json={"username": "password-auth", "password": "Password-Auth-Changed-2026!"},
    ).status_code == 200


def test_change_password_preserves_current_session_and_revokes_every_other_session(
    client,
) -> None:
    _create_user(
        username="password-concurrent",
        password="Password-Concurrent-2026!",
        functions=("author",),
    )
    assert client.post(
        "/api/v1/auth/login",
        json={
            "username": "password-concurrent",
            "password": "Password-Concurrent-2026!",
        },
    ).status_code == 200

    with TestClient(app) as other_client:
        other_login = other_client.post(
            "/api/v1/auth/login",
            json={
                "username": "password-concurrent",
                "password": "Password-Concurrent-2026!",
            },
        )
        assert other_login.status_code == 200
        other_cookie = other_login.cookies.get("newscast_session")
        assert other_cookie

        changed = client.post(
            "/api/v1/auth/change-password",
            json={
                "current_password": "Password-Concurrent-2026!",
                "new_password": "Password-Concurrent-Changed-2026!",
            },
        )

        assert changed.status_code == 200
        assert client.get("/api/v1/auth/me").status_code == 200
        other_client.cookies.set("newscast_session", other_cookie)
        replay = other_client.get("/api/v1/auth/me")

    assert replay.status_code == 401
    assert replay.json()["error"]["code"] == "AUTH_REQUIRED"


def test_changed_password_preserves_leading_and_trailing_spaces(client) -> None:
    _create_user(
        username="password-spaces",
        password="Password-Spaces-2026!",
        functions=("author",),
    )
    assert client.post(
        "/api/v1/auth/login",
        json={"username": "password-spaces", "password": "Password-Spaces-2026!"},
    ).status_code == 200

    exact_password = "  Permanent-Spaces-2026!  "
    changed = client.post(
        "/api/v1/auth/change-password",
        json={
            "current_password": "Password-Spaces-2026!",
            "new_password": exact_password,
        },
    )

    assert changed.status_code == 200
    client.cookies.clear()
    assert client.post(
        "/api/v1/auth/login",
        json={"username": "password-spaces", "password": exact_password},
    ).status_code == 200
    client.cookies.clear()
    assert client.post(
        "/api/v1/auth/login",
        json={"username": "password-spaces", "password": exact_password.strip()},
    ).status_code == 401


def test_change_password_rejects_wrong_current_and_unsafe_new_password(client) -> None:
    _create_user(
        username="password-negative",
        password="Password-Negative-2026!",
        functions=("author",),
    )
    assert client.post(
        "/api/v1/auth/login",
        json={"username": "password-negative", "password": "Password-Negative-2026!"},
    ).status_code == 200

    wrong_current = client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "Wrong-Current-2026!", "new_password": "Safe-New-Password-2026!"},
    )
    unsafe = client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "Password-Negative-2026!", "new_password": "password12345"},
    )

    assert wrong_current.status_code == 400
    assert wrong_current.json()["error"]["code"] == "CURRENT_PASSWORD_INVALID"
    assert unsafe.status_code == 400
    assert unsafe.json()["error"]["code"] == "UNSAFE_PASSWORD"


def test_temporary_password_gate_blocks_domain_requests_until_password_is_changed(client) -> None:
    _create_user(
        username="temporary-password-auth",
        password="Temporary-Auth-2026!",
        functions=("author",),
        must_change_password=True,
    )
    assert client.post(
        "/api/v1/auth/login",
        json={"username": "temporary-password-auth", "password": "Temporary-Auth-2026!"},
    ).status_code == 200

    assert client.get("/api/v1/auth/me").status_code == 200
    blocked = client.get("/api/v1/stories?scope=active")
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "PASSWORD_CHANGE_REQUIRED"

    changed = client.post(
        "/api/v1/auth/change-password",
        json={
            "current_password": "Temporary-Auth-2026!",
            "new_password": "Permanent-Auth-2026!",
        },
    )
    assert changed.status_code == 200
    assert client.get("/api/v1/stories?scope=active").status_code == 200
