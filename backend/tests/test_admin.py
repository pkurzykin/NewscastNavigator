from __future__ import annotations

from threading import Barrier, Lock, Thread
import sys

from sqlalchemy import func, select
import pytest

from app.db.models import User, UserFunction
from app.db.session import SessionLocal, engine
from app.services.demo_seed import seed_demo_data
from app.services.user_admin import ensure_chief_invariant, set_user_active, set_user_functions
import scripts.manage_users as manage_users


@pytest.fixture(autouse=True)
def _synthetic_admin_seed() -> None:
    with SessionLocal() as db:
        seed_demo_data(db)


DEMO_PASSWORD = "Synthetic-Demo-2026!"


def _login(client, username: str) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": DEMO_PASSWORD},
    )
    assert response.status_code == 200, response.text
    return dict(response.cookies)


def test_only_chief_can_create_users_and_assign_combined_functions(client) -> None:
    chief_cookies = _login(client, "astra")
    chief_editor_cookies = _login(client, "iskra")
    payload = {
        "username": "new-synthetic-user",
        "display_name": "Янтарь",
        "position": "Корреспондент",
        "function_codes": ["author", "proofreader"],
        "temporary_password": "New-Synthetic-User-2026!",
    }

    forbidden = client.post(
        "/api/v1/admin/users",
        cookies=chief_editor_cookies,
        json=payload,
    )
    created = client.post(
        "/api/v1/admin/users",
        cookies=chief_cookies,
        json=payload,
    )

    assert forbidden.status_code == 403
    assert created.status_code == 200
    assert created.json()["resource"]["type"] == "user"


def test_admin_update_enforces_known_functions_and_last_active_chief(client) -> None:
    chief_cookies = _login(client, "astra")
    me = client.get(
        "/api/v1/auth/me",
        cookies=chief_cookies,
    ).json()

    unknown = client.patch(
        f"/api/v1/admin/users/{me['id']}",
        cookies=chief_cookies,
        json={"function_codes": ["invented"]},
    )
    with SessionLocal() as db:
        other_chief_id = db.execute(select(User.id).where(User.username == "vega")).scalar_one()
    deactivate_other = client.patch(
        f"/api/v1/admin/users/{other_chief_id}",
        cookies=chief_cookies,
        json={"is_active": False},
    )
    remove_last = client.patch(
        f"/api/v1/admin/users/{me['id']}",
        cookies=chief_cookies,
        json={"is_active": False},
    )

    assert unknown.status_code == 400
    assert unknown.json()["error"]["code"] == "UNKNOWN_FUNCTION"
    assert deactivate_other.status_code == 200
    assert remove_last.status_code == 400
    assert remove_last.json()["error"]["code"] == "LAST_CHIEF_REQUIRED"

    remove_function = client.patch(
        f"/api/v1/admin/users/{me['id']}",
        cookies=chief_cookies,
        json={"function_codes": ["author"]},
    )
    assert remove_function.status_code == 400
    assert remove_function.json()["error"]["code"] == "LAST_CHIEF_REQUIRED"


def test_chief_can_reset_temporary_password(client) -> None:
    chief_cookies = _login(client, "astra")
    created = client.post(
        "/api/v1/admin/users",
        cookies=chief_cookies,
        json={
            "username": "reset-synthetic-user",
            "display_name": "Янтарь",
            "position": "Дизайнер",
            "function_codes": ["designer"],
            "temporary_password": "Before-Reset-2026!",
        },
    ).json()

    reset = client.post(
        f"/api/v1/admin/users/{created['resource']['id']}/reset-password",
        cookies=chief_cookies,
        json={"temporary_password": "After-Reset-2026!"},
    )

    assert reset.status_code == 200
    assert client.post(
        "/api/v1/auth/login",
        json={"username": "reset-synthetic-user", "password": "After-Reset-2026!"},
    ).status_code == 200


def test_temporary_password_preserves_leading_and_trailing_spaces(client) -> None:
    chief_cookies = _login(client, "astra")
    exact_password = "  Temporary-Spaces-2026!  "
    created = client.post(
        "/api/v1/admin/users",
        cookies=chief_cookies,
        json={
            "username": "temporary-spaces-user",
            "display_name": "Янтарь",
            "position": "Корреспондент",
            "function_codes": ["author"],
            "temporary_password": exact_password,
        },
    )

    assert created.status_code == 200
    client.cookies.clear()
    assert client.post(
        "/api/v1/auth/login",
        json={"username": "temporary-spaces-user", "password": exact_password},
    ).status_code == 200
    client.cookies.clear()
    assert client.post(
        "/api/v1/auth/login",
        json={"username": "temporary-spaces-user", "password": exact_password.strip()},
    ).status_code == 401


@pytest.mark.parametrize("temporary_password", [" " * 12, "     short     "])
def test_admin_rejects_passwords_that_are_unsafe_after_strength_normalization(
    client,
    temporary_password: str,
) -> None:
    chief_cookies = _login(client, "astra")

    response = client.post(
        "/api/v1/admin/users",
        cookies=chief_cookies,
        json={
            "username": "unsafe-normalized-password",
            "display_name": "Янтарь",
            "position": "Корреспондент",
            "function_codes": ["author"],
            "temporary_password": temporary_password,
        },
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "UNSAFE_PASSWORD"
    with SessionLocal() as db:
        assert db.scalar(
            select(User.id).where(User.username == "unsafe-normalized-password")
        ) is None


def test_admin_reports_username_password_and_missing_user_errors(client) -> None:
    chief_cookies = _login(client, "astra")
    duplicate = client.post(
        "/api/v1/admin/users",
        cookies=chief_cookies,
        json={
            "username": "astra",
            "display_name": "Янтарь",
            "position": "Корреспондент",
            "function_codes": ["author"],
            "temporary_password": "Duplicate-User-2026!",
        },
    )
    unsafe = client.post(
        "/api/v1/admin/users",
        cookies=chief_cookies,
        json={
            "username": "unsafe-user",
            "display_name": "Янтарь",
            "position": "Корреспондент",
            "function_codes": ["author"],
            "temporary_password": "password12345",
        },
    )
    missing = client.patch(
        "/api/v1/admin/users/999999",
        cookies=chief_cookies,
        json={"display_name": "Янтарь"},
    )
    empty = client.patch(
        "/api/v1/admin/users/999999",
        cookies=chief_cookies,
        json={},
    )

    assert duplicate.status_code == 400
    assert duplicate.json()["error"]["code"] == "USERNAME_TAKEN"
    assert unsafe.status_code == 400
    assert unsafe.json()["error"]["code"] == "UNSAFE_PASSWORD"
    assert missing.status_code == 400
    assert missing.json()["error"]["code"] == "USER_NOT_FOUND"
    assert empty.status_code == 400
    assert empty.json()["error"]["code"] == "EMPTY_PATCH"


def test_admin_normalizes_identity_fields_before_validation_and_persistence(client) -> None:
    chief_cookies = _login(client, "astra")
    created = client.post(
        "/api/v1/admin/users",
        cookies=chief_cookies,
        json={
            "username": "  normalized-user  ",
            "display_name": "  Янтарь  ",
            "position": "  Корреспондент  ",
            "function_codes": ["author"],
            "temporary_password": "Normalized-User-2026!",
        },
    )

    assert created.status_code == 200
    user_id = created.json()["resource"]["id"]
    with SessionLocal() as db:
        user = db.get(User, user_id)
        assert user is not None
        assert (user.username, user.display_name, user.position) == (
            "normalized-user",
            "Янтарь",
            "Корреспондент",
        )


@pytest.mark.parametrize("field", ["username", "display_name", "position"])
def test_admin_rejects_whitespace_only_identity_without_mutation(client, field: str) -> None:
    chief_cookies = _login(client, "astra")
    payload = {
        "username": "whitespace-user",
        "display_name": "Янтарь",
        "position": "Корреспондент",
        "function_codes": ["author"],
        "temporary_password": "Whitespace-User-2026!",
    }
    payload[field] = "   "

    response = client.post("/api/v1/admin/users", cookies=chief_cookies, json=payload)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    with SessionLocal() as db:
        assert db.scalar(select(User.id).where(User.username == "whitespace-user")) is None


def test_admin_rejects_whitespace_only_update_without_mutation(client) -> None:
    chief_cookies = _login(client, "astra")
    with SessionLocal() as db:
        user = db.execute(select(User).where(User.username == "lira")).scalar_one()
        user_id = user.id
        original = (user.display_name, user.position)

    response = client.patch(
        f"/api/v1/admin/users/{user_id}",
        cookies=chief_cookies,
        json={"display_name": "   ", "position": "   "},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    with SessionLocal() as db:
        user = db.get(User, user_id)
        assert user is not None
        assert (user.display_name, user.position) == original


def test_chief_can_list_admin_users_active_first_with_safe_fields_and_function_options(client) -> None:
    chief_cookies = _login(client, "astra")
    with SessionLocal() as db:
        chief = db.execute(select(User).where(User.username == "astra")).scalar_one()
        chief.display_name = "Бета"
        for user in db.execute(select(User).where(User.id != chief.id)).scalars():
            user.is_active = False
            user.display_name = f"Сотрудник {user.id:02d}"

        active_first = User(
            username="list-active-first",
            display_name="Альфа",
            position="Корреспондент",
            password_hash="secret-first",
            is_active=True,
            must_change_password=False,
        )
        active_second = User(
            username="list-active-second",
            display_name="альфа",
            position="Корректор",
            password_hash="secret-second",
            is_active=True,
            must_change_password=True,
        )
        inactive_first = User(
            username="list-inactive-first",
            display_name="Аарон",
            position="Дизайнер",
            password_hash="secret-inactive",
            is_active=False,
            must_change_password=True,
        )
        set_user_functions(active_first, ("author",))
        set_user_functions(active_second, ("proofreader",))
        set_user_functions(inactive_first, ("designer",))
        db.add_all([active_first, active_second, inactive_first])
        db.commit()
        expected_ids = [
            active_first.id,
            active_second.id,
            chief.id,
            inactive_first.id,
            *range(2, 9),
        ]

    response = client.get("/api/v1/admin/users", cookies=chief_cookies)

    assert response.status_code == 200, response.text
    payload = response.json()
    assert [item["id"] for item in payload["items"]] == expected_ids
    assert payload["function_options"] == [
        {"code": "chief", "label": "Начальник"},
        {"code": "chief_editor", "label": "Шеф-редактор"},
        {"code": "author", "label": "Автор"},
        {"code": "proofreader", "label": "Корректор"},
        {"code": "video_editor", "label": "Монтажёр"},
        {"code": "designer", "label": "Дизайнер"},
        {"code": "operator", "label": "Оператор"},
    ]
    for item in payload["items"]:
        assert set(item) == {
            "id",
            "username",
            "display_name",
            "position",
            "function_codes",
            "is_active",
            "must_change_password",
            "created_at",
            "updated_at",
        }
        assert "password_hash" not in item
        assert "password_changed_at" not in item


def test_only_chief_can_list_users(client) -> None:
    chief_editor_cookies = _login(client, "iskra")

    response = client.get("/api/v1/admin/users", cookies=chief_editor_cookies)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"


def test_manage_users_cli_normalizes_identity_and_duplicate_lookup(monkeypatch) -> None:
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "manage_users.py",
            "create-user",
            "  cli-normalized  ",
            "--display-name",
            "  Янтарь  ",
            "--position",
            "  Корреспондент  ",
            "--function",
            "author",
            "--temporary-password",
            "Cli-Normalized-2026!",
        ],
    )
    assert manage_users.main() == 0
    with SessionLocal() as db:
        user = db.execute(select(User).where(User.username == "cli-normalized")).scalar_one()
        assert (user.display_name, user.position) == ("Янтарь", "Корреспондент")

    monkeypatch.setattr(
        sys,
        "argv",
        [
            "manage_users.py",
            "create-user",
            "cli-normalized",
            "--display-name",
            "Янтарь",
            "--position",
            "Корреспондент",
            "--function",
            "author",
            "--temporary-password",
            "Cli-Duplicate-2026!",
        ],
    )
    with pytest.raises(SystemExit, match="Пользователь уже существует"):
        manage_users.main()


@pytest.mark.parametrize(
    ("argument", "value"),
    [("username", "   "), ("--display-name", "   "), ("--position", "   ")],
)
def test_manage_users_cli_rejects_whitespace_identity_without_mutation(
    monkeypatch,
    argument: str,
    value: str,
) -> None:
    username = value if argument == "username" else "cli-whitespace"
    display_name = value if argument == "--display-name" else "Янтарь"
    position = value if argument == "--position" else "Корреспондент"
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "manage_users.py",
            "create-user",
            username,
            "--display-name",
            display_name,
            "--position",
            position,
            "--function",
            "author",
            "--temporary-password",
            "Cli-Whitespace-2026!",
        ],
    )
    with pytest.raises(SystemExit, match="не может быть пустым"):
        manage_users.main()
    with SessionLocal() as db:
        assert db.scalar(select(User.id).where(User.username == "cli-whitespace")) is None


@pytest.mark.skipif(
    engine.dialect.name != "postgresql",
    reason="Проверка сериализации требует PostgreSQL advisory transaction lock",
)
def test_concurrent_last_chief_changes_leave_one_active_chief() -> None:
    with SessionLocal() as db:
        for user in db.execute(select(User)).scalars():
            user.is_active = False
        first = User(
            username="concurrent-chief-a",
            display_name="Астра",
            position="Начальник",
            password_hash="unused",
            is_active=True,
        )
        second = User(
            username="concurrent-chief-b",
            display_name="Вега",
            position="Начальник",
            password_hash="unused",
            is_active=True,
        )
        first.functions = [UserFunction(function_code="chief")]
        second.functions = [UserFunction(function_code="chief")]
        db.add_all([first, second])
        db.commit()
        first_id, second_id = first.id, second.id

    start = Barrier(2)
    result_lock = Lock()
    results: list[str] = []

    def change_chief(user_id: int, *, remove_function: bool) -> None:
        with SessionLocal() as db:
            user = db.get(User, user_id)
            assert user is not None
            start.wait(timeout=5)
            try:
                if remove_function:
                    ensure_chief_invariant(
                        db,
                        user,
                        next_is_active=True,
                        next_function_codes=("author",),
                    )
                    set_user_functions(user, ("author",))
                    db.flush()
                else:
                    set_user_active(db, user, is_active=False)
                db.commit()
                outcome = "success"
            except ValueError as exc:
                db.rollback()
                outcome = str(exc)
            with result_lock:
                results.append(outcome)

    threads = [
        Thread(target=change_chief, args=(first_id,), kwargs={"remove_function": False}),
        Thread(target=change_chief, args=(second_id,), kwargs={"remove_function": True}),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)

    assert all(not thread.is_alive() for thread in threads)
    assert sorted(results) == ["LAST_CHIEF_REQUIRED", "success"]
    with SessionLocal() as db:
        active_chiefs = db.scalar(
            select(func.count(User.id))
            .join(UserFunction, UserFunction.user_id == User.id)
            .where(User.is_active.is_(True), UserFunction.function_code == "chief")
        )
        assert active_chiefs is not None and active_chiefs >= 1
