from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import event

from app.db.models import (
    CorrectionPackage,
    CorrectionPart,
    Notification,
    Scenario,
    ScenarioReadMarker,
    ScenarioRevision,
    ScenarioRevisionRow,
    Story,
    StoryAssignment,
    StoryEvent,
    StoryProductionState,
    StoryWorkflowState,
    User,
    UserFunction,
)
from app.db.session import SessionLocal, engine
from app.services.demo_seed import SYNTHETIC_DEMO_PASSWORD, seed_demo_data


SEGMENT_UID = "seg_123e4567-e89b-12d3-a456-426614175200"


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


def _user_id(username: str) -> int:
    with SessionLocal() as db:
        user_id = db.query(User.id).filter(User.username == username).scalar()
        assert user_id is not None
        return user_id


def _story_for_author(username: str = "lira") -> int:
    with SessionLocal() as db:
        author_id = db.query(User.id).filter(User.username == username).scalar()
        row = (
            db.query(Story.id)
            .filter(Story.author_user_id == author_id, Story.archived_at.is_(None))
            .order_by(Story.id)
            .first()
        )
        story_id = row[0] if row is not None else None
        assert story_id is not None
        return story_id


def _cookies(client, username: str) -> dict[str, str]:
    return _login(client, username)


def _notifications(username: str, *, story_id: int | None = None) -> list[Notification]:
    with SessionLocal() as db:
        query = db.query(Notification).filter(Notification.recipient_user_id == _user_id(username))
        if story_id is not None:
            query = query.filter(Notification.story_id == story_id)
        return list(query.order_by(Notification.id).all())


def _assign(story_id: int, kind: str, username: str, actor: str = "astra") -> None:
    with SessionLocal() as db:
        db.add(
            StoryAssignment(
                story_id=story_id,
                kind=kind,
                user_id=db.query(User.id).filter(User.username == username).scalar(),
                assigned_by_user_id=db.query(User.id).filter(User.username == actor).scalar(),
            )
        )
        db.commit()


def _workflow_command(client, story_id: int, command: str, username: str, revision: int = 0):
    return client.post(
        f"/api/v1/stories/{story_id}/workflow/{command}",
        json={"revision": revision},
        cookies=_cookies(client, username),
    )


def _production_command(
    client,
    story_id: int,
    path: str,
    username: str,
    body: dict | None = None,
):
    return client.post(
        f"/api/v1/stories/{story_id}/production/{path}",
        json={} if body is None else body,
        cookies=_cookies(client, username),
    )


def _start_edit(client, story_id: int, username: str) -> tuple[dict[str, str], dict]:
    cookies = _cookies(client, username)
    lease = client.post(
        f"/api/v1/stories/{story_id}/scenario/lease",
        json={},
        cookies=cookies,
    )
    assert lease.status_code == 200, lease.text
    return cookies, lease.json()


def _save(
    client,
    story_id: int,
    cookies: dict[str, str],
    lease: dict,
    *,
    base_revision: int,
    client_save_id: str,
    text: str,
) -> int:
    response = client.put(
        f"/api/v1/stories/{story_id}/scenario",
        json={
            "base_revision": base_revision,
            "client_save_id": client_save_id,
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
    return response.json()["revision"]


def _release(client, story_id: int, cookies: dict[str, str], lease: dict):
    return client.request(
        "DELETE",
        f"/api/v1/stories/{story_id}/scenario/lease",
        json={
            "edit_session_id": lease["edit_session_id"],
            "lease_token": lease["lease_token"],
        },
        cookies=cookies,
    )


def test_notification_list_is_recipient_isolated_ordered_and_read_is_idempotent(client) -> None:
    story_id = _story_for_author()
    astra_id = _user_id("astra")
    iskra_id = _user_id("iskra")
    lira_id = _user_id("lira")
    now = datetime.now(UTC)
    with SessionLocal() as db:
        first = Notification(
            recipient_user_id=iskra_id,
            story_id=story_id,
            kind="review_requested",
            actor_user_id=lira_id,
            payload={
                "title": "Текст ждёт редакционной проверки",
                "summary": "Лира отправила сценарий на проверку",
                "target_href": f"/stories/{story_id}/scenario",
            },
            created_at=now - timedelta(minutes=2),
            updated_at=now - timedelta(minutes=2),
        )
        second = Notification(
            recipient_user_id=iskra_id,
            story_id=story_id,
            kind="scenario_changed_after_proofread",
            actor_user_id=lira_id,
            edit_session_id=None,
            payload={
                "title": "Сценарий изменён после вычитки",
                "summary": "Изменена одна строка",
                "target_href": f"/stories/{story_id}/scenario",
                "diff": {
                    "from_revision": 2,
                    "to_revision": 4,
                    "summary": {"added": 0, "removed": 0, "changed": 1, "moved": 0, "total": 1},
                    "changes": [{"segment_uid": SEGMENT_UID, "kind": "changed"}],
                    "href": f"/stories/{story_id}/history?session=19",
                },
            },
            created_at=now - timedelta(minutes=1),
            updated_at=now - timedelta(minutes=1),
        )
        foreign = Notification(
            recipient_user_id=astra_id,
            story_id=story_id,
            kind="review_requested",
            actor_user_id=lira_id,
            payload={
                "title": "Чужое уведомление",
                "summary": "Не должно попасть в выдачу",
                "target_href": f"/stories/{story_id}/scenario",
            },
            created_at=now,
            updated_at=now,
        )
        db.add_all([first, second, foreign])
        db.commit()
        first_id, second_id, foreign_id = first.id, second.id, foreign.id

    listed = client.get(
        "/api/v1/notifications?unread=true&limit=50",
        cookies=_cookies(client, "iskra"),
    )
    assert listed.status_code == 200, listed.text
    payload = listed.json()
    assert set(payload) == {"items", "total", "unread_count"}
    assert payload["total"] == 2
    assert payload["unread_count"] == 2
    assert [item["id"] for item in payload["items"]] == [second_id, first_id]
    assert set(payload["items"][0]) == {
        "id", "kind", "story", "actor", "title", "summary", "target_href", "diff",
        "created_at", "updated_at", "read_at",
    }
    assert payload["items"][0]["story"] == {
        "id": story_id,
        "title": "Учебный сюжет 03",
        "priority": {"code": "standard", "label": "Стандарт"},
    }
    assert payload["items"][0]["actor"]["username"] == "lira"
    assert payload["items"][0]["diff"]["from_revision"] == 2
    assert payload["items"][0]["diff"]["to_revision"] == 4
    assert payload["items"][0]["diff"]["summary"]["total"] == 1

    first_read = client.post(
        f"/api/v1/notifications/{second_id}/read",
        json={},
        cookies=_cookies(client, "iskra"),
    )
    second_read = client.post(
        f"/api/v1/notifications/{second_id}/read",
        json={},
        cookies=_cookies(client, "iskra"),
    )
    assert first_read.status_code == 200, first_read.text
    assert second_read.status_code == 200, second_read.text
    assert first_read.json()["event_id"] is None
    assert first_read.json()["resource"] == {"type": "notification", "id": second_id}
    with SessionLocal() as db:
        read_at = db.get(Notification, second_id).read_at
        assert read_at is not None
        assert db.get(Notification, second_id).read_at == read_at

    unread = client.get(
        "/api/v1/notifications?unread=true&limit=50",
        cookies=_cookies(client, "iskra"),
    ).json()
    assert unread["total"] == 1 and unread["unread_count"] == 1
    assert [item["id"] for item in unread["items"]] == [first_id]

    foreign_read = client.post(
        f"/api/v1/notifications/{foreign_id}/read",
        json={},
        cookies=_cookies(client, "iskra"),
    )
    missing = client.post(
        "/api/v1/notifications/999999/read",
        json={},
        cookies=_cookies(client, "iskra"),
    )
    assert foreign_read.status_code == 403
    assert foreign_read.json()["error"]["code"] == "NOTIFICATION_NOT_RECIPIENT"
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "NOTIFICATION_NOT_FOUND"


def test_assignment_and_workflow_delivery_excludes_actor_and_inactive_recipients(client) -> None:
    story_id = _story_for_author("lira")
    orion_id = _user_id("orion")
    assigned = client.put(
        f"/api/v1/stories/{story_id}/assignments/video_editor",
        json={"user_id": orion_id},
        cookies=_cookies(client, "astra"),
    )
    assert assigned.status_code == 200, assigned.text
    assert [item.kind for item in _notifications("orion", story_id=story_id)] == ["assignment"]
    assert _notifications("astra", story_id=story_id) == []

    repeated_assignment = client.put(
        f"/api/v1/stories/{story_id}/assignments/video_editor",
        json={"user_id": orion_id},
        cookies=_cookies(client, "astra"),
    )
    assert repeated_assignment.status_code == 200, repeated_assignment.text
    assert [item.kind for item in _notifications("orion", story_id=story_id)] == ["assignment"]

    with SessionLocal() as db:
        astra_id = db.query(User.id).filter(User.username == "astra").scalar()
        assert astra_id is not None
        db.add(UserFunction(user_id=astra_id, function_code="video_editor"))
        db.commit()
    self_assignment = client.put(
        f"/api/v1/stories/{story_id}/assignments/video_editor",
        json={"user_id": _user_id("astra")},
        cookies=_cookies(client, "astra"),
    )
    assert self_assignment.status_code == 200, self_assignment.text
    assert _notifications("astra", story_id=story_id) == []

    with SessionLocal() as db:
        inactive = db.query(User).filter(User.username == "astra").one()
        inactive.is_active = False
        db.commit()

    review = _workflow_command(client, story_id, "submit-review", "lira")
    assert review.status_code == 200, review.text
    assert [item.kind for item in _notifications("iskra", story_id=story_id)] == [
        "review_requested"
    ]
    assert _notifications("astra", story_id=story_id) == []

    second_story = _story_for_author("iskra")
    own_review = _workflow_command(client, second_story, "submit-review", "iskra")
    assert own_review.status_code == 200, own_review.text
    assert _notifications("iskra", story_id=second_story) == []


def test_proofread_and_reproofread_requests_notify_only_assigned_active_proofreader(client) -> None:
    story_id = _story_for_author("lira")
    _assign(story_id, "proofreader", "mayak")

    editorial = _workflow_command(client, story_id, "confirm-editorial", "astra")
    assert editorial.status_code == 200, editorial.text
    assert [item.kind for item in _notifications("mayak", story_id=story_id)] == [
        "proofread_requested"
    ]

    marked = _workflow_command(client, story_id, "mark-proofread", "mayak")
    assert marked.status_code == 200, marked.text
    with SessionLocal() as db:
        state = db.get(StoryWorkflowState, story_id)
        state.changed_after_proofread = True
        db.commit()
    reproofread = _workflow_command(client, story_id, "request-reproofread", "astra")
    assert reproofread.status_code == 200, reproofread.text
    assert [item.kind for item in _notifications("mayak", story_id=story_id)] == [
        "proofread_requested",
        "reproofread_requested",
    ]
    assert _notifications("astra", story_id=story_id) == []


def test_multiple_autosaves_deliver_no_late_edit_until_finalization_then_one_grouped_diff(client) -> None:
    story_id = _story_for_author("lira")
    with SessionLocal() as db:
        state = db.get(StoryWorkflowState, story_id)
        state.proofread_revision = 0
        state.proofread_by_user_id = _user_id("mayak")
        state.proofread_at = datetime.now(UTC)
        db.commit()

    cookies, lease = _start_edit(client, story_id, "lira")
    revision_one = _save(
        client,
        story_id,
        cookies,
        lease,
        base_revision=0,
        client_save_id="late_edit_save_1",
        text="Первая промежуточная формулировка",
    )
    revision_two = _save(
        client,
        story_id,
        cookies,
        lease,
        base_revision=revision_one,
        client_save_id="late_edit_save_2",
        text="Итоговая синтетическая формулировка",
    )
    assert revision_two == 2
    assert _notifications("iskra", story_id=story_id) == []
    assert _notifications("astra", story_id=story_id) == []

    events_before_release: int
    with SessionLocal() as db:
        events_before_release = db.query(StoryEvent).filter(StoryEvent.story_id == story_id).count()
    released = _release(client, story_id, cookies, lease)
    assert released.status_code == 200, released.text

    chief_editor_notifications = _notifications("iskra", story_id=story_id)
    assert len(chief_editor_notifications) == 1
    item = chief_editor_notifications[0]
    assert item.kind == "scenario_changed_after_proofread"
    assert item.edit_session_id == lease["edit_session_id"]
    assert item.payload["target_href"] == f"/stories/{story_id}/scenario"
    assert item.payload["diff"]["from_revision"] == 0
    assert item.payload["diff"]["to_revision"] == 2
    assert item.payload["diff"]["summary"]["total"] == 1
    assert item.payload["diff"]["changes"][0]["after"]["text"] == "Итоговая синтетическая формулировка"
    assert _notifications("astra", story_id=story_id) == []
    with SessionLocal() as db:
        assert db.query(StoryEvent).filter(StoryEvent.story_id == story_id).count() == events_before_release


def test_proofreader_self_edit_advances_mark_and_notifies_other_chief_editors(client) -> None:
    story_id = _story_for_author("lira")
    _assign(story_id, "proofreader", "mayak")
    with SessionLocal() as db:
        state = db.get(StoryWorkflowState, story_id)
        state.proofread_revision = 0
        state.proofread_by_user_id = _user_id("mayak")
        state.proofread_at = datetime.now(UTC)
        db.commit()

    cookies, lease = _start_edit(client, story_id, "mayak")
    revision = _save(
        client,
        story_id,
        cookies,
        lease,
        base_revision=0,
        client_save_id="proofreader_self_edit",
        text="Корректор исправил опечатку",
    )
    assert _notifications("iskra", story_id=story_id) == []
    assert _release(client, story_id, cookies, lease).status_code == 200

    with SessionLocal() as db:
        state = db.get(StoryWorkflowState, story_id)
        assert state.proofread_revision == revision
        assert state.changed_after_proofread is False
    items = _notifications("iskra", story_id=story_id)
    assert len(items) == 1
    assert items[0].kind == "scenario_changed_after_proofread"
    assert items[0].payload["diff"]["from_revision"] == 0
    assert items[0].payload["diff"]["to_revision"] == revision


def test_downstream_late_edit_uses_recipient_baseline_and_opened_context_marks_selectively(client) -> None:
    story_id = _story_for_author("lira")
    _assign(story_id, "video_editor", "orion")
    _assign(story_id, "designer", "runa")

    # Establish immutable revisions 1 and 2, then use deliberately older/newer recipient markers.
    cookies, first_lease = _start_edit(client, story_id, "lira")
    revision_one = _save(
        client,
        story_id,
        cookies,
        first_lease,
        base_revision=0,
        client_save_id="baseline_save_1",
        text="Редакция один",
    )
    assert _release(client, story_id, cookies, first_lease).status_code == 200
    cookies, second_lease = _start_edit(client, story_id, "lira")
    revision_two = _save(
        client,
        story_id,
        cookies,
        second_lease,
        base_revision=revision_one,
        client_save_id="baseline_save_2",
        text="Редакция два",
    )
    assert _release(client, story_id, cookies, second_lease).status_code == 200

    now = datetime.now(UTC)
    with SessionLocal() as db:
        production = db.get(StoryProductionState, story_id)
        production.video_started_revision = 0
        production.video_started_by_user_id = _user_id("orion")
        production.video_started_at = now
        production.titles_started_revision = 0
        production.titles_started_by_user_id = _user_id("runa")
        production.titles_started_at = now
        db.add_all(
            [
                ScenarioReadMarker(
                    story_id=story_id,
                    user_id=_user_id("orion"),
                    context="video",
                    revision_no=revision_one,
                ),
                ScenarioReadMarker(
                    story_id=story_id,
                    user_id=_user_id("runa"),
                    context="titles",
                    revision_no=revision_one,
                ),
                ScenarioReadMarker(
                    story_id=story_id,
                    user_id=_user_id("runa"),
                    context="captionpanels",
                    revision_no=revision_two,
                ),
            ]
        )
        db.commit()

    cookies, late_lease = _start_edit(client, story_id, "lira")
    revision_three = _save(
        client,
        story_id,
        cookies,
        late_lease,
        base_revision=revision_two,
        client_save_id="downstream_late_save",
        text="Редакция три",
    )
    assert _release(client, story_id, cookies, late_lease).status_code == 200

    video = _notifications("orion", story_id=story_id)
    titles = _notifications("runa", story_id=story_id)
    assert len(video) == 1 and video[0].kind == "scenario_changed_video"
    assert video[0].payload["target_href"] == f"/stories/{story_id}/scenario?production_context=video"
    assert video[0].payload["diff"]["from_revision"] == revision_one
    assert video[0].payload["diff"]["to_revision"] == revision_three
    assert len(titles) == 1 and titles[0].kind == "scenario_changed_titles"
    assert titles[0].payload["target_href"] == f"/stories/{story_id}/scenario?production_context=titles"
    assert titles[0].payload["diff"]["from_revision"] == revision_two

    # Scenario context does not acknowledge downstream work.
    opened_scenario = client.post(
        f"/api/v1/stories/{story_id}/scenario/opened",
        json={"revision": revision_three, "context": "scenario"},
        cookies=_cookies(client, "orion"),
    )
    assert opened_scenario.status_code == 200
    assert _notifications("orion", story_id=story_id)[0].read_at is None

    opened_video = client.post(
        f"/api/v1/stories/{story_id}/scenario/opened",
        json={"revision": revision_three, "context": "video"},
        cookies=_cookies(client, "orion"),
    )
    assert opened_video.status_code == 200
    assert _notifications("orion", story_id=story_id)[0].read_at is not None

    # A stale open cannot regress the marker or acknowledge a later notification.
    with SessionLocal() as db:
        later = Notification(
            recipient_user_id=_user_id("orion"),
            story_id=story_id,
            kind="scenario_changed_video",
            actor_user_id=_user_id("lira"),
            payload={
                "title": "Новая правка сценария для монтажа",
                "summary": "Есть более поздняя редакция",
                "target_href": f"/stories/{story_id}/scenario?production_context=video",
                "diff": {"from_revision": revision_three, "to_revision": revision_three + 1, "summary": {"total": 1}, "changes": []},
            },
        )
        db.add(later)
        db.commit()
        later_id = later.id
    stale_open = client.post(
        f"/api/v1/stories/{story_id}/scenario/opened",
        json={"revision": revision_one, "context": "video"},
        cookies=_cookies(client, "orion"),
    )
    assert stale_open.status_code == 200
    with SessionLocal() as db:
        marker = db.query(ScenarioReadMarker).filter_by(
            story_id=story_id,
            user_id=_user_id("orion"),
            context="video",
        ).one()
        assert marker.revision_no == revision_three
        assert db.get(Notification, later_id).read_at is None


def test_late_diff_keeps_the_revision_opened_during_an_active_edit_session(client) -> None:
    story_id = _story_for_author("lira")
    _assign(story_id, "video_editor", "orion")
    with SessionLocal() as db:
        production = db.get(StoryProductionState, story_id)
        production.video_started_revision = 0
        production.video_started_by_user_id = _user_id("orion")
        production.video_started_at = datetime.now(UTC)
        db.commit()

    cookies, lease = _start_edit(client, story_id, "lira")
    revision_one = _save(
        client,
        story_id,
        cookies,
        lease,
        base_revision=0,
        client_save_id="active_marker_save_1",
        text="Монтажёр открыл эту редакцию",
    )
    opened = client.post(
        f"/api/v1/stories/{story_id}/scenario/opened",
        json={"revision": revision_one, "context": "video"},
        cookies=_cookies(client, "orion"),
    )
    assert opened.status_code == 200, opened.text
    revision_two = _save(
        client,
        story_id,
        cookies,
        lease,
        base_revision=revision_one,
        client_save_id="active_marker_save_2",
        text="После открытия появилась ещё одна правка",
    )
    assert _release(client, story_id, cookies, lease).status_code == 200

    items = _notifications("orion", story_id=story_id)
    assert len(items) == 1
    assert items[0].payload["diff"]["from_revision"] == revision_one
    assert items[0].payload["diff"]["to_revision"] == revision_two
    assert items[0].payload["diff"]["summary"]["total"] == 1
    assert items[0].payload["diff"]["changes"][0]["kind"] == "changed"
    assert items[0].payload["diff"]["changes"][0]["before"]["text"] == "Монтажёр открыл эту редакцию"

    listed = client.get(
        "/api/v1/notifications?unread=true&limit=50",
        cookies=_cookies(client, "orion"),
    )
    assert listed.status_code == 200, listed.text
    listed_item = next(item for item in listed.json()["items"] if item["id"] == items[0].id)
    assert listed_item["diff"]["href"] == (
        f"/stories/{story_id}/history?notification={items[0].id}"
    )

    exact_comparison = client.get(
        f"/api/v1/stories/{story_id}/history/notifications/{items[0].id}",
        cookies=_cookies(client, "orion"),
    )
    assert exact_comparison.status_code == 200, exact_comparison.text
    exact_payload = exact_comparison.json()
    assert exact_payload["session"]["id"] == lease["edit_session_id"]
    assert exact_payload["session"]["from_revision"] == revision_one
    assert exact_payload["session"]["to_revision"] == revision_two
    assert exact_payload["changes"] == items[0].payload["diff"]["changes"]
    assert exact_payload["changes"][0]["before"]["text"] == "Монтажёр открыл эту редакцию"

    session_comparison = client.get(
        f"/api/v1/stories/{story_id}/history/edit-sessions/{lease['edit_session_id']}",
        cookies=_cookies(client, "orion"),
    )
    assert session_comparison.status_code == 200, session_comparison.text
    assert session_comparison.json()["session"]["from_revision"] == 0
    assert session_comparison.json()["changes"][0]["before"] is None

    foreign_comparison = client.get(
        f"/api/v1/stories/{story_id}/history/notifications/{items[0].id}",
        cookies=_cookies(client, "runa"),
    )
    assert foreign_comparison.status_code == 403
    assert foreign_comparison.json()["error"]["code"] == "NOTIFICATION_NOT_RECIPIENT"

    next_cookies, next_lease = _start_edit(client, story_id, "lira")
    revision_three = _save(
        client,
        story_id,
        next_cookies,
        next_lease,
        base_revision=revision_two,
        client_save_id="active_marker_next_session",
        text="Следующий сеанс тоже сравнивается с открытой редакцией",
    )
    assert _release(client, story_id, next_cookies, next_lease).status_code == 200

    items = _notifications("orion", story_id=story_id)
    assert len(items) == 2
    assert items[1].payload["diff"]["from_revision"] == revision_one
    assert items[1].payload["diff"]["to_revision"] == revision_three
    assert items[1].payload["diff"]["changes"][0]["before"]["text"] == "Монтажёр открыл эту редакцию"


def test_late_diff_keeps_an_intermediate_stage_start_revision_across_edit_sessions(client) -> None:
    story_id = _story_for_author("lira")
    _assign(story_id, "video_editor", "orion")

    cookies, first_lease = _start_edit(client, story_id, "lira")
    stage_revision = _save(
        client,
        story_id,
        cookies,
        first_lease,
        base_revision=0,
        client_save_id="stage_baseline_save_1",
        text="Монтаж начат с этой редакции",
    )
    started = _production_command(
        client,
        story_id,
        "video/start",
        "orion",
        {"revision": stage_revision},
    )
    assert started.status_code == 200, started.text
    revision_two = _save(
        client,
        story_id,
        cookies,
        first_lease,
        base_revision=stage_revision,
        client_save_id="stage_baseline_save_2",
        text="Поздняя правка первого сеанса",
    )
    assert _release(client, story_id, cookies, first_lease).status_code == 200

    next_cookies, next_lease = _start_edit(client, story_id, "lira")
    revision_three = _save(
        client,
        story_id,
        next_cookies,
        next_lease,
        base_revision=revision_two,
        client_save_id="stage_baseline_next_session",
        text="Поздняя правка второго сеанса",
    )
    assert _release(client, story_id, next_cookies, next_lease).status_code == 200

    items = _notifications("orion", story_id=story_id)
    assert len(items) == 2
    second_diff = items[1].payload["diff"]
    assert second_diff["from_revision"] == stage_revision
    assert second_diff["to_revision"] == revision_three
    assert second_diff["summary"] == {
        "added": 0,
        "removed": 0,
        "changed": 1,
        "moved": 0,
        "total": 1,
    }
    assert second_diff["changes"][0]["kind"] == "changed"
    assert second_diff["changes"][0]["before"]["text"] == "Монтаж начат с этой редакции"
    assert second_diff["changes"][0]["after"]["text"] == "Поздняя правка второго сеанса"


def test_later_finalization_prunes_a_stale_intermediate_baseline_but_keeps_boundaries(client) -> None:
    story_id = _story_for_author("lira")
    _assign(story_id, "video_editor", "orion")

    cookies, first_lease = _start_edit(client, story_id, "lira")
    old_baseline = _save(
        client,
        story_id,
        cookies,
        first_lease,
        base_revision=0,
        client_save_id="prune_old_baseline",
        text="Старый промежуточный baseline",
    )
    assert _production_command(
        client,
        story_id,
        "video/start",
        "orion",
        {"revision": old_baseline},
    ).status_code == 200
    first_boundary = _save(
        client,
        story_id,
        cookies,
        first_lease,
        base_revision=old_baseline,
        client_save_id="prune_first_boundary",
        text="Граница первого сеанса",
    )
    assert _release(client, story_id, cookies, first_lease).status_code == 200

    next_cookies, next_lease = _start_edit(client, story_id, "lira")
    new_baseline = _save(
        client,
        story_id,
        next_cookies,
        next_lease,
        base_revision=first_boundary,
        client_save_id="prune_new_baseline",
        text="Новый эффективный baseline",
    )
    opened = client.post(
        f"/api/v1/stories/{story_id}/scenario/opened",
        json={"revision": new_baseline, "context": "video"},
        cookies=_cookies(client, "orion"),
    )
    assert opened.status_code == 200, opened.text
    with SessionLocal() as db:
        production = db.get(StoryProductionState, story_id)
        assert production is not None
        production.video_started_revision = new_baseline
        db.commit()
    latest_boundary = _save(
        client,
        story_id,
        next_cookies,
        next_lease,
        base_revision=new_baseline,
        client_save_id="prune_latest_boundary",
        text="Граница второго сеанса",
    )
    snapshot_deletes: list[str] = []

    def capture_snapshot_delete(
        _connection,
        _cursor,
        statement: str,
        _parameters,
        _context,
        _executemany,
    ) -> None:
        normalized = " ".join(statement.upper().split())
        if normalized.startswith("DELETE FROM SCENARIO_REVISION_ROWS"):
            snapshot_deletes.append(normalized)

    event.listen(engine, "before_cursor_execute", capture_snapshot_delete)
    try:
        assert _release(client, story_id, next_cookies, next_lease).status_code == 200
    finally:
        event.remove(engine, "before_cursor_execute", capture_snapshot_delete)

    assert len(snapshot_deletes) == 1
    assert "SELECT SCENARIO_REVISIONS.ID" in snapshot_deletes[0]
    assert "SELECT SCENARIO_EDIT_SESSIONS.LATEST_REVISION_NO" in snapshot_deletes[0]
    assert "SELECT SCENARIO_READ_MARKERS.REVISION_NO" in snapshot_deletes[0]

    with SessionLocal() as db:
        scenario = db.query(Scenario).filter(Scenario.story_id == story_id).one()
        revisions = {
            revision.revision_no: revision
            for revision in db.query(ScenarioRevision).filter(
                ScenarioRevision.scenario_id == scenario.id,
                ScenarioRevision.revision_no.in_(
                    {old_baseline, first_boundary, new_baseline, latest_boundary}
                ),
            )
        }
        row_counts = {
            revision_no: db.query(ScenarioRevisionRow).filter(
                ScenarioRevisionRow.revision_id == revision.id
            ).count()
            for revision_no, revision in revisions.items()
        }
    assert row_counts == {
        old_baseline: 0,
        first_boundary: 1,
        new_baseline: 1,
        latest_boundary: 1,
    }

    second_diff = _notifications("orion", story_id=story_id)[1].payload["diff"]
    assert second_diff["from_revision"] == new_baseline
    assert second_diff["changes"][0]["before"]["text"] == "Новый эффективный baseline"

    restored = client.post(
        f"/api/v1/stories/{story_id}/history/edit-sessions/{first_lease['edit_session_id']}/restore",
        json={},
        cookies=_cookies(client, "astra"),
    )
    assert restored.status_code == 200, restored.text
    scenario = client.get(
        f"/api/v1/stories/{story_id}/scenario",
        cookies=_cookies(client, "lira"),
    ).json()["scenario"]
    assert scenario["rows"][0]["text"] == "Граница первого сеанса"


def test_production_and_correction_events_deliver_to_active_recipients_without_duplicates(client) -> None:
    story_id = _story_for_author("lira")
    _assign(story_id, "video_editor", "orion")
    _assign(story_id, "designer", "runa")

    started = _production_command(
        client,
        story_id,
        "video/start",
        "orion",
        {"revision": 0},
    )
    ready = _production_command(client, story_id, "video/ready", "orion")
    assert started.status_code == 200 and ready.status_code == 200
    assert [item.kind for item in _notifications("astra", story_id=story_id)] == ["video_ready"]
    assert [item.kind for item in _notifications("iskra", story_id=story_id)] == ["video_ready"]
    assert _notifications("orion", story_id=story_id) == []

    package_response = client.post(
        f"/api/v1/stories/{story_id}/correction-packages",
        json={
            "source": "internal",
            "parts": [
                {
                    "scope": "text",
                    "description": "Уточнить синтетическую формулировку",
                    "assignee_user_id": _user_id("mayak"),
                }
            ],
        },
        cookies=_cookies(client, "astra"),
    )
    assert package_response.status_code == 200, package_response.text
    package_id = package_response.json()["resource"]["id"]
    assigned_parts = _notifications("mayak", story_id=story_id)
    assert [item.kind for item in assigned_parts] == ["correction_part_assigned"]
    assert assigned_parts[0].payload["target_href"] == f"/stories/{story_id}/production"

    with SessionLocal() as db:
        part_id = db.query(CorrectionPart.id).filter(CorrectionPart.package_id == package_id).scalar()
    completed = client.post(
        f"/api/v1/stories/{story_id}/correction-packages/{package_id}/parts/{part_id}/complete",
        json={"completion_action": "none"},
        cookies=_cookies(client, "mayak"),
    )
    assert completed.status_code == 200, completed.text
    assert [item.kind for item in _notifications("astra", story_id=story_id)] == [
        "video_ready",
        "correction_part_completed",
        "correction_package_ready",
    ]
    assert [item.kind for item in _notifications("iskra", story_id=story_id)] == [
        "video_ready",
        "correction_part_completed",
        "correction_package_ready",
    ]
    assert [item.id for item in _notifications("mayak", story_id=story_id)] == [
        item.id for item in assigned_parts
    ]
