from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from threading import Barrier, Lock, Thread
import sys

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
import pytest

from app.db.models import (
    CorrectionPackage,
    ExternalApprovalCycle,
    Notification,
    Rubric,
    Scenario,
    ScenarioEditSession,
    ScenarioReadMarker,
    ScenarioRevision,
    Story,
    StoryAssignment,
    StoryEvent,
    StoryMaterialLink,
    StoryProductionState,
    StoryWorkflowState,
    User,
    UserFunction,
    UserSession,
)
from app.db.session import SessionLocal, engine
from app.main import app
from app.api.routes.admin import require_chief
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


def _cookies(client, username: str) -> dict[str, str]:
    return _login(client, username)


@pytest.fixture()
def db_session() -> Session:
    with SessionLocal() as db:
        yield db


def _user_by_username(db: Session, username: str) -> User:
    return db.execute(select(User).where(User.username == username)).scalar_one()


def _user_by_id(db: Session, user_id: int) -> User:
    return db.get(User, user_id)  # type: ignore[return-value]


def _create_unused_user(db: Session) -> User:
    user = User(
        username="unused-user",
        display_name="Неиспользуемый",
        position="Корреспондент",
        password_hash="unused-password-hash",
        is_active=True,
        must_change_password=False,
    )
    set_user_functions(user, ("author",))
    db.add(user)
    db.commit()
    return user


def _create_story(db: Session) -> Story:
    story = Story(
        title="Тестовый сюжет удаления",
        rubric_id=db.scalar(select(Rubric.id).order_by(Rubric.id)) or 0,
        author_user_id=_user_by_username(db, "astra").id,
        priority="standard",
    )
    db.add(story)
    db.flush()
    return story


def _create_unused_user_with_technical_records(db: Session) -> User:
    user = _create_unused_user(db)
    story = _create_story(db)
    db.add_all(
        [
            UserSession(
                id="unused-user-session",
                user_id=user.id,
                created_at=datetime.now(UTC),
                expires_at=datetime.now(UTC) + timedelta(days=1),
            ),
            ScenarioReadMarker(
                story_id=story.id,
                user_id=user.id,
                context="scenario",
                revision_no=0,
            ),
            Notification(
                recipient_user_id=user.id,
                story_id=story.id,
                kind="test_technical_notification",
            ),
        ]
    )
    db.commit()
    return user


def _reference_story_author(db: Session, user: User) -> None:
    story = _create_story(db)
    story.author_user_id = user.id


def _reference_assignment(db: Session, user: User) -> None:
    db.add(
        StoryAssignment(
            story_id=_create_story(db).id,
            kind="designer",
            user_id=user.id,
            assigned_by_user_id=_user_by_username(db, "astra").id,
        )
    )


def _reference_material(db: Session, user: User) -> None:
    db.add(
        StoryMaterialLink(
            story_id=_create_story(db).id,
            title="Тестовый материал",
            location="https://media.demo.invalid/delete-test",
            added_by_user_id=user.id,
        )
    )


def _reference_scenario_edit_session(db: Session, user: User) -> None:
    story = _create_story(db)
    scenario = Scenario(story_id=story.id)
    db.add(scenario)
    db.flush()
    db.add(
        ScenarioEditSession(
            scenario_id=scenario.id,
            actor_user_id=user.id,
            lease_token_hash="a" * 64,
            base_revision_no=0,
            latest_revision_no=0,
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        )
    )


def _reference_scenario_revision(db: Session, user: User) -> None:
    story = _create_story(db)
    scenario = Scenario(story_id=story.id)
    db.add(scenario)
    db.flush()
    db.add(
        ScenarioRevision(
            scenario_id=scenario.id,
            revision_no=1,
            client_save_id="delete-reference-revision",
            created_by_user_id=user.id,
        )
    )


def _reference_story_event_actor(db: Session, user: User) -> None:
    db.add(
        StoryEvent(
            story_id=_create_story(db).id,
            event_code="test_delete_blocker",
            actor_user_id=user.id,
        )
    )


def _reference_workflow_actor(db: Session, user: User) -> None:
    db.add(StoryWorkflowState(story_id=_create_story(db).id, editorial_by_user_id=user.id))


def _reference_production_actor(db: Session, user: User) -> None:
    db.add(StoryProductionState(story_id=_create_story(db).id, video_ready_by_user_id=user.id))


def _reference_correction_actor(db: Session, user: User) -> None:
    db.add(
        CorrectionPackage(
            story_id=_create_story(db).id,
            source="internal",
            created_by_user_id=_user_by_username(db, "astra").id,
            closed_by_user_id=user.id,
        )
    )


def _reference_external_actor(db: Session, user: User) -> None:
    db.add(
        ExternalApprovalCycle(
            story_id=_create_story(db).id,
            cycle_no=1,
            sent_by_user_id=_user_by_username(db, "astra").id,
            result="approved",
            decided_by_user_id=user.id,
        )
    )


def _reference_notification_actor(db: Session, user: User) -> None:
    db.add(
        Notification(
            recipient_user_id=_user_by_username(db, "astra").id,
            story_id=_create_story(db).id,
            kind="test_history_notification",
            actor_user_id=user.id,
        )
    )


@pytest.fixture(
    params=[
        _reference_story_author,
        _reference_assignment,
        _reference_material,
        _reference_scenario_edit_session,
        _reference_scenario_revision,
        _reference_story_event_actor,
        _reference_workflow_actor,
        _reference_production_actor,
        _reference_correction_actor,
        _reference_external_actor,
        _reference_notification_actor,
    ],
    ids=[
        "author",
        "assignment",
        "material",
        "scenario-edit-session",
        "scenario-revision",
        "story-event-actor",
        "workflow-actor",
        "production-actor",
        "correction-actor",
        "external-actor",
        "notification-actor",
    ],
)
def reference_factory(request) -> Callable[[Session, User], None]:
    return request.param


def test_chief_updates_normalized_unique_username_without_changing_password(client, db_session) -> None:
    before = _user_by_username(db_session, "runa")
    before_hash = before.password_hash
    before_must_change = before.must_change_password
    response = client.patch(
        f"/api/v1/admin/users/{before.id}",
        json={"username": "  runa-new  "},
        cookies=_cookies(client, "astra"),
    )
    assert response.status_code == 200, response.text
    db_session.expire_all()
    changed = _user_by_username(db_session, "runa-new")
    assert changed.password_hash == before_hash
    assert changed.must_change_password is before_must_change


def test_username_conflict_is_rejected_without_partial_profile_update(client, db_session) -> None:
    target = _user_by_username(db_session, "runa")
    response = client.patch(
        f"/api/v1/admin/users/{target.id}",
        json={"username": "astra", "display_name": "Не сохранять"},
        cookies=_cookies(client, "astra"),
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "USERNAME_TAKEN"
    db_session.expire_all()
    assert _user_by_id(db_session, target.id).display_name != "Не сохранять"


@pytest.mark.parametrize("username", ["   ", "u" * 121])
def test_admin_rejects_empty_or_too_long_username_update(client, db_session, username: str) -> None:
    target = _user_by_username(db_session, "runa")

    response = client.patch(
        f"/api/v1/admin/users/{target.id}",
        json={"username": username},
        cookies=_cookies(client, "astra"),
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_non_chief_cannot_rename_user(client, db_session) -> None:
    target = _user_by_username(db_session, "runa")

    response = client.patch(
        f"/api/v1/admin/users/{target.id}",
        json={"username": "runa-new"},
        cookies=_cookies(client, "iskra"),
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"


def test_renamed_user_keeps_current_session_and_uses_new_login(client, db_session) -> None:
    target = _user_by_username(db_session, "runa")
    chief_cookies = _cookies(client, "astra")

    with TestClient(app) as renamed_user_client:
        login = renamed_user_client.post(
            "/api/v1/auth/login",
            json={"username": "runa", "password": DEMO_PASSWORD},
        )
        assert login.status_code == 200

        renamed = client.patch(
            f"/api/v1/admin/users/{target.id}",
            json={"username": "runa-new"},
            cookies=chief_cookies,
        )
        assert renamed.status_code == 200, renamed.text
        assert renamed_user_client.get("/api/v1/auth/me").status_code == 200

        renamed_user_client.cookies.clear()
        assert renamed_user_client.post(
            "/api/v1/auth/login",
            json={"username": "runa", "password": DEMO_PASSWORD},
        ).status_code == 401
        assert renamed_user_client.post(
            "/api/v1/auth/login",
            json={"username": "runa-new", "password": DEMO_PASSWORD},
        ).status_code == 200


def test_chief_deletes_unused_user_and_technical_records(client, db_session) -> None:
    user = _create_unused_user_with_technical_records(db_session)
    user_id = user.id
    response = client.delete(
        f"/api/v1/admin/users/{user_id}",
        cookies=_cookies(client, "astra"),
    )
    assert response.status_code == 200, response.text
    assert response.json()["resource"] == {"type": "user", "id": user_id}
    db_session.expire_all()
    assert db_session.get(User, user_id) is None


def test_delete_blocks_every_domain_or_history_reference(client, db_session, reference_factory) -> None:
    user = _create_unused_user(db_session)
    reference_factory(db_session, user)
    db_session.commit()
    response = client.delete(
        f"/api/v1/admin/users/{user.id}",
        cookies=_cookies(client, "astra"),
    )
    assert response.status_code == 409
    assert response.json()["error"] == {
        "code": "USER_DELETE_BLOCKED",
        "message": "Сотрудник уже участвовал в работе. Отключите учётную запись",
        "details": {},
    }


def test_delete_rejects_self_non_chief_and_missing_user(client, db_session) -> None:
    astra = _user_by_username(db_session, "astra")
    unused = _create_unused_user(db_session)

    self_delete = client.delete(
        f"/api/v1/admin/users/{astra.id}",
        cookies=_cookies(client, "astra"),
    )
    non_chief = client.delete(
        f"/api/v1/admin/users/{unused.id}",
        cookies=_cookies(client, "iskra"),
    )
    missing = client.delete(
        "/api/v1/admin/users/999999",
        cookies=_cookies(client, "astra"),
    )

    assert self_delete.status_code == 409
    assert self_delete.json()["error"]["code"] == "CANNOT_DELETE_SELF"
    assert non_chief.status_code == 403
    assert non_chief.json()["error"]["code"] == "FORBIDDEN"
    assert missing.status_code == 400
    assert missing.json()["error"]["code"] == "USER_NOT_FOUND"


def test_delete_last_active_chief_returns_conflict(client, db_session) -> None:
    astra = _user_by_username(db_session, "astra")
    vega = _user_by_username(db_session, "vega")
    astra.is_active = False
    db_session.commit()

    app.dependency_overrides[require_chief] = lambda: astra
    try:
        response = client.delete(
            f"/api/v1/admin/users/{vega.id}",
        )
    finally:
        app.dependency_overrides.pop(require_chief, None)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "LAST_CHIEF_REQUIRED"


def test_delete_fails_closed_when_commit_detects_unexpected_fk_reference(
    client,
    db_session,
    monkeypatch,
) -> None:
    user = _create_unused_user(db_session)
    chief_cookies = _cookies(client, "astra")

    def fail_commit(_self: Session) -> None:
        raise IntegrityError("DELETE", {}, RuntimeError("unexpected FK reference"))

    monkeypatch.setattr(Session, "commit", fail_commit)
    response = client.delete(
        f"/api/v1/admin/users/{user.id}",
        cookies=chief_cookies,
    )

    assert response.status_code == 409
    assert response.json()["error"] == {
        "code": "USER_DELETE_BLOCKED",
        "message": "Сотрудник уже участвовал в работе. Отключите учётную запись",
        "details": {},
    }


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


def test_admin_password_reset_revokes_every_existing_user_session(client) -> None:
    chief_cookies = _login(client, "astra")
    with SessionLocal() as db:
        user_id = db.execute(
            select(User.id).where(User.username == "lira")
        ).scalar_one()

    with TestClient(app) as user_client:
        login = user_client.post(
            "/api/v1/auth/login",
            json={"username": "lira", "password": DEMO_PASSWORD},
        )
        assert login.status_code == 200
        old_cookie = login.cookies.get("newscast_session")
        assert old_cookie
        assert user_client.get("/api/v1/auth/me").status_code == 200

        reset = client.post(
            f"/api/v1/admin/users/{user_id}/reset-password",
            cookies=chief_cookies,
            json={"temporary_password": "Reset-Revoke-2026!"},
        )
        assert reset.status_code == 200

        user_client.cookies.set("newscast_session", old_cookie)
        replay = user_client.get("/api/v1/auth/me")

    assert replay.status_code == 401
    assert replay.json()["error"]["code"] == "AUTH_REQUIRED"


def test_deactivate_then_reactivate_does_not_revive_an_old_session(client) -> None:
    chief_cookies = _login(client, "astra")
    with SessionLocal() as db:
        user_id = db.execute(
            select(User.id).where(User.username == "lira")
        ).scalar_one()

    with TestClient(app) as user_client:
        login = user_client.post(
            "/api/v1/auth/login",
            json={"username": "lira", "password": DEMO_PASSWORD},
        )
        assert login.status_code == 200
        old_cookie = login.cookies.get("newscast_session")
        assert old_cookie

        deactivated = client.patch(
            f"/api/v1/admin/users/{user_id}",
            cookies=chief_cookies,
            json={"is_active": False},
        )
        assert deactivated.status_code == 200
        assert user_client.get("/api/v1/auth/me").status_code == 401

        reactivated = client.patch(
            f"/api/v1/admin/users/{user_id}",
            cookies=chief_cookies,
            json={"is_active": True},
        )
        assert reactivated.status_code == 200
        user_client.cookies.set("newscast_session", old_cookie)
        replay = user_client.get("/api/v1/auth/me")

    assert replay.status_code == 401
    assert replay.json()["error"]["code"] == "AUTH_REQUIRED"


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
