from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.db.models import (
    Scenario,
    ScenarioEditSession,
    Story,
    StoryAssignment,
    StoryEvent,
    StoryWorkflowState,
    User,
)
from app.db.session import SessionLocal
from app.services.demo_seed import SYNTHETIC_DEMO_PASSWORD, seed_demo_data


SEGMENT_UID = "seg_123e4567-e89b-12d3-a456-426614174410"


@pytest.fixture(autouse=True)
def _seed_synthetic_stories() -> None:
    with SessionLocal() as db:
        seed_demo_data(db)


def _login(client, username: str) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": SYNTHETIC_DEMO_PASSWORD},
    )
    assert response.status_code == 200, response.text
    return dict(response.cookies)


def _story_for_author(username: str) -> int:
    with SessionLocal() as db:
        user = db.query(User).filter(User.username == username).one()
        story = (
            db.query(Story)
            .filter(Story.author_user_id == user.id, Story.archived_at.is_(None))
            .order_by(Story.id)
            .first()
        )
        assert story is not None
        return story.id


def _revision(story_id: int) -> int:
    with SessionLocal() as db:
        return db.query(Scenario).filter(Scenario.story_id == story_id).one().revision_no


def _assign_proofreader(story_id: int, username: str = "mayak") -> None:
    with SessionLocal() as db:
        proofreader = db.query(User).filter(User.username == username).one()
        chief = db.query(User).filter(User.username == "astra").one()
        db.add(
            StoryAssignment(
                story_id=story_id,
                kind="proofreader",
                user_id=proofreader.id,
                assigned_by_user_id=chief.id,
            )
        )
        db.commit()


def _command(client, story_id: int, command: str, revision: int, username: str):
    return client.post(
        f"/api/v1/stories/{story_id}/workflow/{command}",
        json={"revision": revision},
        cookies=_login(client, username),
    )


def _save(client, story_id: int, username: str, *, base_revision: int, text: str) -> int:
    cookies = _login(client, username)
    lease_response = client.post(
        f"/api/v1/stories/{story_id}/scenario/lease", json={}, cookies=cookies
    )
    assert lease_response.status_code == 200, lease_response.text
    lease = lease_response.json()
    response = client.put(
        f"/api/v1/stories/{story_id}/scenario",
        json={
            "base_revision": base_revision,
            "client_save_id": f"workflow_save_{username}_{base_revision}",
            "edit_session_id": lease["edit_session_id"],
            "lease_token": lease["lease_token"],
            "rows": [
                {
                    "segment_uid": SEGMENT_UID,
                    "order_index": 1,
                    "block_type": "zk",
                    "text": text,
                }
            ],
        },
        cookies=cookies,
    )
    assert response.status_code == 200, response.text
    released = client.request(
        "DELETE",
        f"/api/v1/stories/{story_id}/scenario/lease",
        json={
            "edit_session_id": lease["edit_session_id"],
            "lease_token": lease["lease_token"],
        },
        cookies=cookies,
    )
    assert released.status_code == 200, released.text
    return response.json()["revision"]


def _workflow(client, story_id: int, username: str) -> dict:
    response = client.get(
        f"/api/v1/stories/{story_id}/workflow", cookies=_login(client, username)
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_regular_author_submits_current_revision_once_and_non_author_is_forbidden(client) -> None:
    story_id = _story_for_author("lira")
    revision = _revision(story_id)

    forbidden = _command(client, story_id, "submit-review", revision, "orion")
    submitted = _command(client, story_id, "submit-review", revision, "lira")
    duplicate = _command(client, story_id, "submit-review", revision, "lira")

    assert forbidden.status_code == 403
    assert forbidden.json()["error"]["code"] == "FORBIDDEN"
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["event_id"]
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "REVIEW_ALREADY_REQUESTED"
    with SessionLocal() as db:
        state = db.get(StoryWorkflowState, story_id)
        assert state is not None
        assert state.review_requested_revision == revision
        events = db.query(StoryEvent).filter(StoryEvent.story_id == story_id).all()
        assert [event.event_code for event in events] == ["review_requested"]


def test_leadership_confirms_editorial_and_regular_author_cannot(client) -> None:
    story_id = _story_for_author("lira")
    revision = _revision(story_id)
    assert _command(client, story_id, "submit-review", revision, "lira").status_code == 200

    forbidden = _command(client, story_id, "confirm-editorial", revision, "lira")
    confirmed = _command(client, story_id, "confirm-editorial", revision, "astra")
    duplicate = _command(client, story_id, "confirm-editorial", revision, "iskra")

    assert forbidden.status_code == 403
    assert forbidden.json()["error"]["code"] == "FORBIDDEN"
    assert confirmed.status_code == 200, confirmed.text
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "EDITORIAL_ALREADY_CONFIRMED"


def test_workflow_command_does_not_end_another_users_live_lease(client) -> None:
    story_id = _story_for_author("lira")
    author = _login(client, "lira")
    lease_response = client.post(
        f"/api/v1/stories/{story_id}/scenario/lease", json={}, cookies=author
    )
    assert lease_response.status_code == 200, lease_response.text
    lease = lease_response.json()

    confirmed = _command(client, story_id, "confirm-editorial", 0, "astra")

    assert confirmed.status_code == 200, confirmed.text
    with SessionLocal() as db:
        session = db.get(ScenarioEditSession, lease["edit_session_id"])
        assert session is not None
        assert session.ended_at is None

    saved = client.put(
        f"/api/v1/stories/{story_id}/scenario",
        json={
            "base_revision": 0,
            "client_save_id": "save_after_other_users_workflow_command",
            "edit_session_id": lease["edit_session_id"],
            "lease_token": lease["lease_token"],
            "rows": [
                {
                    "segment_uid": SEGMENT_UID,
                    "order_index": 1,
                    "block_type": "zk",
                    "text": "Чужая workflow-команда не прервала ввод",
                }
            ],
        },
        cookies=author,
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["revision"] == 1


def test_assigned_proofreader_or_leadership_marks_current_revision(client) -> None:
    story_id = _story_for_author("lira")
    _assign_proofreader(story_id)
    revision = _revision(story_id)

    unassigned = _command(client, story_id, "mark-proofread", revision, "orion")
    marked = _command(client, story_id, "mark-proofread", revision, "mayak")

    assert unassigned.status_code == 403
    assert unassigned.json()["error"]["code"] == "PROOFREADER_NOT_ASSIGNED"
    assert marked.status_code == 200, marked.text
    workflow = _workflow(client, story_id, "lira")
    assert workflow["proofread"]["revision"] == revision
    assert workflow["proofread"]["actor"]["username"] == "mayak"
    assert workflow["changed_after_proofread"] is False

    other_story_id = _story_for_author("iskra")
    leadership_mark = _command(
        client, other_story_id, "mark-proofread", _revision(other_story_id), "astra"
    )
    assert leadership_mark.status_code == 200, leadership_mark.text


@pytest.mark.parametrize(
    ("command", "username"),
    [
        ("submit-review", "lira"),
        ("confirm-editorial", "astra"),
        ("mark-proofread", "astra"),
        ("request-reproofread", "astra"),
    ],
)
def test_every_workflow_command_rejects_stale_revision_without_changes(
    client, command: str, username: str
) -> None:
    story_id = _story_for_author("lira")
    with SessionLocal() as db:
        before = db.get(StoryWorkflowState, story_id)
        assert before is not None
        snapshot = {
            column.name: getattr(before, column.name)
            for column in StoryWorkflowState.__table__.columns
        }

    response = _command(client, story_id, command, _revision(story_id) + 1, username)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "REVISION_NOT_CURRENT"
    with SessionLocal() as db:
        after = db.get(StoryWorkflowState, story_id)
        assert after is not None
        assert {
            column.name: getattr(after, column.name)
            for column in StoryWorkflowState.__table__.columns
        } == snapshot
        assert db.query(StoryEvent).filter(StoryEvent.story_id == story_id).count() == 0


def test_combined_functions_get_one_primary_server_action_without_self_request(client) -> None:
    leadership_author = _story_for_author("vega")
    direct = _workflow(client, leadership_author, "vega")

    assert direct["primary_action"] == {
        "code": "confirm_editorial",
        "label": "Текст готов",
        "method": "POST",
        "href": f"/api/v1/stories/{leadership_author}/workflow/confirm-editorial",
        "emphasis": "primary",
        "confirmation": None,
        "form": None,
    }
    assert all(action["code"] != "submit_review" for action in direct["additional_actions"])
    assert [action["code"] for action in direct["additional_actions"]] == ["mark_proofread"]

    author_proofreader = _story_for_author("mayak")
    _assign_proofreader(author_proofreader, "mayak")
    combined = _workflow(client, author_proofreader, "mayak")
    assert combined["primary_action"]["code"] == "submit_review"
    assert [action["code"] for action in combined["additional_actions"]] == ["mark_proofread"]
    assert all(action["href"].startswith(f"/api/v1/stories/{author_proofreader}/workflow/") for action in [combined["primary_action"], *combined["additional_actions"]])


def test_read_model_actions_follow_current_state_and_have_exact_revision_commands(client) -> None:
    story_id = _story_for_author("lira")
    _assign_proofreader(story_id)
    author = _workflow(client, story_id, "lira")
    chief = _workflow(client, story_id, "astra")
    unrelated = _workflow(client, story_id, "orion")

    assert author["story_id"] == story_id
    assert author["primary_action"]["label"] == "Отправить на проверку"
    assert author["primary_action"]["href"].endswith("/workflow/submit-review")
    assert author["additional_actions"] == []
    assert chief["primary_action"]["code"] == "submit_review"
    assert [action["code"] for action in chief["additional_actions"]] == ["mark_proofread"]
    assert unrelated["primary_action"] is None
    assert unrelated["additional_actions"] == []

    assert _command(client, story_id, "submit-review", _revision(story_id), "lira").status_code == 200
    leadership = _workflow(client, story_id, "astra")
    assert leadership["primary_action"]["code"] == "confirm_editorial"
    assert leadership["primary_action"]["label"] == "Подтвердить редакционную готовность"
    assert [action["code"] for action in leadership["additional_actions"]] == ["mark_proofread"]


def test_late_edit_keeps_marks_and_sets_changed_after_proofread_for_non_proofreader(client) -> None:
    story_id = _story_for_author("lira")
    _assign_proofreader(story_id)
    revision = _revision(story_id)
    assert _command(client, story_id, "confirm-editorial", revision, "astra").status_code == 200
    assert _command(client, story_id, "mark-proofread", revision, "mayak").status_code == 200

    next_revision = _save(
        client, story_id, "lira", base_revision=revision, text="Поздняя авторская правка"
    )

    workflow = _workflow(client, story_id, "lira")
    assert next_revision == revision + 1
    assert workflow["editorial_check"]["revision"] == revision
    assert workflow["proofread"]["revision"] == revision
    assert workflow["changed_after_proofread"] is True


def test_proofreader_self_edit_advances_proofread_mark_without_changed_flag(client) -> None:
    story_id = _story_for_author("lira")
    _assign_proofreader(story_id)
    revision = _revision(story_id)
    assert _command(client, story_id, "mark-proofread", revision, "mayak").status_code == 200

    next_revision = _save(
        client, story_id, "mayak", base_revision=revision, text="Корректор исправил опечатку"
    )

    workflow = _workflow(client, story_id, "mayak")
    assert workflow["proofread"]["revision"] == next_revision
    assert workflow["proofread"]["actor"]["username"] == "mayak"
    assert workflow["changed_after_proofread"] is False


def test_reproofread_is_explicit_leadership_only_and_completion_clears_request(client) -> None:
    story_id = _story_for_author("lira")
    _assign_proofreader(story_id)
    revision = _revision(story_id)
    no_proofread = _command(client, story_id, "request-reproofread", revision, "astra")
    assert no_proofread.status_code == 409
    assert no_proofread.json()["error"]["code"] == "PROOFREAD_NOT_PRESENT"
    assert _command(client, story_id, "mark-proofread", revision, "mayak").status_code == 200
    no_late_change = _command(client, story_id, "request-reproofread", revision, "astra")
    assert no_late_change.status_code == 409
    assert no_late_change.json()["error"]["code"] == "INVALID_TRANSITION"
    current = _save(client, story_id, "lira", base_revision=revision, text="Правка после вычитки")

    forbidden = _command(client, story_id, "request-reproofread", current, "lira")
    requested = _command(client, story_id, "request-reproofread", current, "astra")
    duplicate = _command(client, story_id, "request-reproofread", current, "iskra")

    assert forbidden.status_code == 403
    assert forbidden.json()["error"]["code"] == "FORBIDDEN"
    assert requested.status_code == 200, requested.text
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "REPROOFREAD_ALREADY_REQUESTED"
    proofreader_view = _workflow(client, story_id, "mayak")
    assert proofreader_view["primary_action"]["code"] == "mark_proofread"
    assert _command(client, story_id, "mark-proofread", current, "mayak").status_code == 200
    completed = _workflow(client, story_id, "astra")
    assert completed["proofread"]["revision"] == current
    assert completed["changed_after_proofread"] is False
    assert completed["reproofread_request"] is None


@pytest.mark.parametrize("username", ["mayak", "astra"])
def test_late_edit_requires_explicit_reproofread_before_proofread_completion(
    client, username: str
) -> None:
    story_id = _story_for_author("lira")
    _assign_proofreader(story_id)
    revision = _revision(story_id)
    assert _command(client, story_id, "mark-proofread", revision, "mayak").status_code == 200
    current = _save(client, story_id, "lira", base_revision=revision, text="Поздняя правка")
    before = _workflow(client, story_id, "lira")
    with SessionLocal() as db:
        event_count = db.query(StoryEvent).filter(StoryEvent.story_id == story_id).count()

    rejected = _command(client, story_id, "mark-proofread", current, username)

    assert rejected.status_code == 409
    assert rejected.json()["error"]["code"] == "INVALID_TRANSITION"
    assert _workflow(client, story_id, "lira") == before
    with SessionLocal() as db:
        assert db.query(StoryEvent).filter(StoryEvent.story_id == story_id).count() == event_count


def test_restore_uses_same_late_revision_transition_and_archived_commands_are_rejected(client) -> None:
    story_id = _story_for_author("lira")
    _assign_proofreader(story_id)
    initial = _save(client, story_id, "lira", base_revision=0, text="Первая редакция")
    assert _command(client, story_id, "mark-proofread", initial, "mayak").status_code == 200
    later = _save(client, story_id, "lira", base_revision=initial, text="Вторая редакция")
    history = client.get(
        f"/api/v1/stories/{story_id}/history", cookies=_login(client, "astra")
    ).json()
    source_session_id = next(
        item["id"] for item in history["items"] if item["to_revision"] == initial
    )

    restored = client.post(
        f"/api/v1/stories/{story_id}/history/edit-sessions/{source_session_id}/restore",
        json={},
        cookies=_login(client, "astra"),
    )

    assert restored.status_code == 200, restored.text
    workflow = _workflow(client, story_id, "astra")
    assert workflow["proofread"]["revision"] == initial
    assert workflow["changed_after_proofread"] is True
    assert _revision(story_id) == later + 1

    with SessionLocal() as db:
        story = db.get(Story, story_id)
        assert story is not None
        story.aired_at = datetime.now(UTC)
        story.archived_at = datetime.now(UTC)
        db.commit()
    archived = _command(client, story_id, "confirm-editorial", _revision(story_id), "astra")
    assert archived.status_code == 409
    assert archived.json()["error"]["code"] == "STORY_ARCHIVED"
    archived_read = _workflow(client, story_id, "astra")
    assert archived_read["primary_action"] is None
    assert archived_read["additional_actions"] == []
