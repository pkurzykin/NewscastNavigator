from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.db.models import Rubric, Scenario, Story, StoryAssignment, StoryEvent, User
from app.db.session import SessionLocal
from app.services.demo_seed import SYNTHETIC_DEMO_PASSWORD, seed_demo_data


@pytest.fixture(autouse=True)
def _seed_synthetic_stories() -> None:
    with SessionLocal() as db:
        seed_demo_data(db)


def _cookies(client, username: str) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": SYNTHETIC_DEMO_PASSWORD},
    )
    assert response.status_code == 200, response.text
    return dict(response.cookies)


def test_active_stories_are_filtered_sorted_and_return_read_model(client) -> None:
    response = client.get(
        "/api/v1/stories",
        params={"scope": "active", "priority": "high", "search": "Учебный сюжет"},
        cookies=_cookies(client, "lira"),
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] == 4
    assert [item["priority"]["code"] for item in payload["items"]] == ["high"] * 4
    assert all(item["archived_at"] is None for item in payload["items"])
    assert all(
        set(item) >= {"id", "title", "priority", "rubric", "author", "situation", "assignments", "created_at", "archived_at"}
        for item in payload["items"]
    )
    assert [item["id"] for item in payload["items"]] == sorted(
        (item["id"] for item in payload["items"]), reverse=True
    )


def test_active_story_list_places_high_priority_before_standard_priority(client) -> None:
    response = client.get("/api/v1/stories", cookies=_cookies(client, "lira"))

    assert response.status_code == 200, response.text
    priorities = [item["priority"]["code"] for item in response.json()["items"]]
    assert priorities == sorted(priorities, key=lambda priority: priority != "high")


def test_priority_defaults_to_standard_and_registry_returns_activity_dates(client) -> None:
    cookies = _cookies(client, "lira")
    options = client.get("/api/v1/stories/create-options", cookies=cookies).json()
    created = client.post(
        "/api/v1/stories",
        json={
            "title": "Синтетический стандартный приоритет",
            "rubric_id": options["rubrics"][0]["id"],
            "author_user_id": options["authors"][0]["id"],
        },
        cookies=cookies,
    )

    assert created.status_code == 200, created.text
    story = client.get(
        f"/api/v1/stories/{created.json()['resource']['id']}",
        cookies=cookies,
    ).json()
    assert story["priority"] == {"code": "standard", "label": "Стандарт"}
    assert story["updated_at"] == story["created_at"]
    assert story["management"] is None


def test_leadership_creates_and_updates_high_priority_from_server_actions(client) -> None:
    cookies = _cookies(client, "astra")
    options = client.get("/api/v1/stories/create-options", cookies=cookies).json()

    assert options["priority_options"] == [
        {"code": "standard", "label": "Стандарт"},
        {"code": "high", "label": "Высокий"},
    ]
    created = client.post(
        "/api/v1/stories",
        json={
            "title": "Синтетический высокий приоритет",
            "rubric_id": options["rubrics"][0]["id"],
            "author_user_id": options["authors"][0]["id"],
            "priority": "high",
        },
        cookies=cookies,
    )
    assert created.status_code == 200, created.text
    story_id = created.json()["resource"]["id"]
    story = client.get(f"/api/v1/stories/{story_id}", cookies=cookies).json()

    assert story["priority"]["code"] == "high"
    assert story["management"]["action"] == {
        "code": "story_management_update",
        "label": "Изменить автора или приоритет",
        "method": "PATCH",
        "href": f"/api/v1/stories/{story_id}/management",
        "emphasis": "normal",
        "confirmation": None,
        "form": None,
    }
    changed = client.patch(
        story["management"]["action"]["href"],
        json={"priority": "standard"},
        cookies=cookies,
    )

    assert changed.status_code == 200, changed.text
    assert (
        client.get(f"/api/v1/stories/{story_id}", cookies=cookies).json()["priority"]["code"]
        == "standard"
    )


def test_leadership_management_exposes_valid_authors_and_updates_author_and_priority_once(client) -> None:
    leadership = _cookies(client, "astra")
    ordinary = _cookies(client, "lira")
    story = client.get("/api/v1/stories", cookies=leadership).json()["items"][0]
    with SessionLocal() as db:
        target_username = "lira" if story["author"]["username"] != "lira" else "mayak"
        target = db.query(User).filter(User.username == target_username).one()
        non_author = db.query(User).filter(User.username == "orion").one()
        previous_updated_at = db.get(Story, story["id"]).updated_at
        target_id = target.id
        non_author_id = non_author.id

    assert story["management"]["action"] == {
        "code": "story_management_update",
        "label": "Изменить автора или приоритет",
        "method": "PATCH",
        "href": f"/api/v1/stories/{story['id']}/management",
        "emphasis": "normal",
        "confirmation": None,
        "form": None,
    }
    assert target_id in {
        item["id"] for item in story["management"]["author_options"]
    }
    assert non_author_id not in {
        item["id"] for item in story["management"]["author_options"]
    }
    assert story["management"]["priority_options"] == [
        {"code": "standard", "label": "Стандарт"},
        {"code": "high", "label": "Высокий"},
    ]
    assert (
        client.get(f"/api/v1/stories/{story['id']}", cookies=ordinary).json()["management"]
        is None
    )

    next_priority = "standard" if story["priority"]["code"] == "high" else "high"
    changed = client.patch(
        story["management"]["action"]["href"],
        json={"author_user_id": target_id, "priority": next_priority},
        cookies=leadership,
    )

    assert changed.status_code == 200, changed.text
    assert changed.json()["event_id"] is not None
    reread = client.get(f"/api/v1/stories/{story['id']}", cookies=leadership).json()
    assert reread["author"]["id"] == target_id
    assert reread["priority"]["code"] == next_priority
    with SessionLocal() as db:
        updated = db.get(Story, story["id"])
        events = (
            db.query(StoryEvent)
            .filter_by(story_id=story["id"], event_code="story_management_changed")
            .all()
        )
        assert updated is not None and updated.updated_at > previous_updated_at
        assert len(events) == 1
        assert set(events[0].payload) == {"author", "priority"}

    history = client.get(
        f"/api/v1/stories/{story['id']}/history",
        cookies=leadership,
    ).json()
    management_event = next(
        item
        for item in history["items"]
        if item["kind"] == "workflow_event"
        and item["event_code"] == "story_management_changed"
    )
    assert "Автор:" in management_event["summary"]
    assert "Приоритет:" in management_event["summary"]


def test_story_management_rejects_empty_invalid_inactive_and_archived_targets(client) -> None:
    leadership = _cookies(client, "astra")
    story = client.get("/api/v1/stories", cookies=leadership).json()["items"][0]
    with SessionLocal() as db:
        non_author = db.query(User).filter(User.username == "orion").one()
        inactive_author = db.query(User).filter(User.username == "mayak").one()
        inactive_author.is_active = False
        db.commit()
        non_author_id = non_author.id
        inactive_author_id = inactive_author.id

    empty = client.patch(
        f"/api/v1/stories/{story['id']}/management",
        json={},
        cookies=leadership,
    )
    non_author = client.patch(
        f"/api/v1/stories/{story['id']}/management",
        json={"author_user_id": non_author_id},
        cookies=leadership,
    )
    inactive = client.patch(
        f"/api/v1/stories/{story['id']}/management",
        json={"author_user_id": inactive_author_id},
        cookies=leadership,
    )
    forbidden = client.patch(
        f"/api/v1/stories/{story['id']}/management",
        json={"priority": "high"},
        cookies=_cookies(client, "lira"),
    )
    archived = client.get(
        "/api/v1/stories",
        params={"scope": "archive"},
        cookies=leadership,
    ).json()["items"][0]
    archived_change = client.patch(
        f"/api/v1/stories/{archived['id']}/management",
        json={"priority": "high"},
        cookies=leadership,
    )

    assert empty.status_code == 400
    assert empty.json()["error"]["code"] == "EMPTY_PATCH"
    for response in (non_author, inactive):
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "AUTHOR_FUNCTION_REQUIRED"
    assert forbidden.status_code == 403
    assert forbidden.json()["error"]["code"] == "FORBIDDEN"
    assert archived_change.status_code == 409
    assert archived_change.json()["error"]["code"] == "STORY_ARCHIVED"


def test_non_leadership_cannot_create_or_change_high_priority(client) -> None:
    cookies = _cookies(client, "lira")
    options = client.get("/api/v1/stories/create-options", cookies=cookies).json()

    assert options["priority_options"] == [{"code": "standard", "label": "Стандарт"}]
    rejected = client.post(
        "/api/v1/stories",
        json={
            "title": "Запрещённый высокий приоритет",
            "rubric_id": options["rubrics"][0]["id"],
            "author_user_id": options["authors"][0]["id"],
            "priority": "high",
        },
        cookies=cookies,
    )

    assert rejected.status_code == 403
    assert rejected.json()["error"]["code"] == "FORBIDDEN"


def test_reading_story_does_not_change_activity_timestamp(client) -> None:
    cookies = _cookies(client, "astra")
    story = client.get("/api/v1/stories", cookies=cookies).json()["items"][0]

    client.get(f"/api/v1/stories/{story['id']}", cookies=cookies)
    reread = client.get(
        f"/api/v1/stories/{story['id']}",
        cookies=cookies,
    ).json()

    assert reread["updated_at"] == story["updated_at"]


def test_archive_scope_and_mine_filter_never_mix_archived_and_active_stories(client) -> None:
    response = client.get(
        "/api/v1/stories",
        params={"scope": "archive", "mine": "true", "limit": 200},
        cookies=_cookies(client, "lira"),
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] == 2
    assert all(item["archived_at"] is not None for item in payload["items"])
    assert all(item["author"]["username"] == "lira" for item in payload["items"])


def test_author_can_update_own_story_metadata_but_not_someone_elses_story(client) -> None:
    stories = client.get("/api/v1/stories", cookies=_cookies(client, "lira")).json()["items"]
    own_story = next(item for item in stories if item["author"]["username"] == "lira")
    other_story = next(item for item in stories if item["author"]["username"] != "lira")
    lira_cookies = _cookies(client, "lira")

    updated = client.patch(
        f"/api/v1/stories/{own_story['id']}/metadata",
        json={"title": "Новый учебный заголовок"},
        cookies=lira_cookies,
    )
    forbidden = client.patch(
        f"/api/v1/stories/{other_story['id']}/metadata",
        json={"title": "Чужой заголовок"},
        cookies=lira_cookies,
    )

    assert updated.status_code == 200, updated.text
    assert updated.json()["resource"] == {"type": "story", "id": own_story["id"]}
    assert forbidden.status_code == 403
    assert forbidden.json()["error"]["code"] == "FORBIDDEN"


def test_story_metadata_uses_conflict_for_unavailable_rubric_and_validation_for_blank_title(
    client,
) -> None:
    cookies = _cookies(client, "lira")
    story = next(
        item
        for item in client.get("/api/v1/stories", cookies=cookies).json()["items"]
        if item["author"]["username"] == "lira"
    )
    with SessionLocal() as db:
        inactive_rubric = Rubric(
            name="Синтетическая недоступная рубрика",
            is_active=False,
        )
        db.add(inactive_rubric)
        db.commit()
        inactive_rubric_id = inactive_rubric.id

    unavailable = client.patch(
        f"/api/v1/stories/{story['id']}/metadata",
        json={"rubric_id": inactive_rubric_id},
        cookies=cookies,
    )
    blank_title = client.patch(
        f"/api/v1/stories/{story['id']}/metadata",
        json={"title": "   "},
        cookies=cookies,
    )

    assert unavailable.status_code == 409
    assert unavailable.json()["error"]["code"] == "RUBRIC_INACTIVE"
    assert blank_title.status_code == 422
    assert blank_title.json()["error"]["code"] == "VALIDATION_ERROR"


def test_duration_text_metadata_patch_normalizes_explicit_null_and_preserves_scenario_revision(client) -> None:
    cookies = _cookies(client, "lira")
    story = next(
        item
        for item in client.get("/api/v1/stories", cookies=cookies).json()["items"]
        if item["author"]["username"] == "lira"
    )
    with SessionLocal() as db:
        stored_story = db.get(Story, story["id"])
        scenario = db.query(Scenario).filter(Scenario.story_id == story["id"]).one()
        assert stored_story is not None
        stored_story.updated_at = datetime(2020, 1, 1, tzinfo=UTC)
        db.commit()
        revision_before = scenario.revision_no

    updated = client.patch(
        f"/api/v1/stories/{story['id']}/metadata",
        json={"duration_text": "  до 5 минут  "},
        cookies=cookies,
    )
    no_op = client.patch(
        f"/api/v1/stories/{story['id']}/metadata",
        json={"duration_text": "до 5 минут"},
        cookies=cookies,
    )
    cleared = client.patch(
        f"/api/v1/stories/{story['id']}/metadata",
        json={"duration_text": None},
        cookies=cookies,
    )
    blank_cleared = client.patch(
        f"/api/v1/stories/{story['id']}/metadata",
        json={"duration_text": "   "},
        cookies=cookies,
    )

    assert updated.status_code == 200, updated.text
    assert updated.json()["event_id"] is not None
    assert no_op.status_code == 200, no_op.text
    assert no_op.json()["event_id"] is None
    assert cleared.status_code == 200, cleared.text
    assert blank_cleared.status_code == 200, blank_cleared.text
    assert client.get(f"/api/v1/stories/{story['id']}", cookies=cookies).json()["duration_text"] is None
    with SessionLocal() as db:
        stored_story = db.get(Story, story["id"])
        scenario = db.query(Scenario).filter(Scenario.story_id == story["id"]).one()
        events = (
            db.query(StoryEvent)
            .filter_by(story_id=story["id"], event_code="story_metadata_changed")
            .order_by(StoryEvent.id)
            .all()
        )
        assert stored_story is not None
        assert stored_story.duration_text is None
        assert stored_story.updated_at.replace(tzinfo=UTC) > datetime(2020, 1, 1, tzinfo=UTC)
        assert scenario.revision_no == revision_before
        assert [event.payload for event in events] == [
            {"duration_text": {"from": None, "to": "до 5 минут"}},
            {"duration_text": {"from": "до 5 минут", "to": None}},
        ]


def test_duration_text_metadata_patch_enforces_length_permissions_and_archive(client) -> None:
    author = _cookies(client, "lira")
    leadership = _cookies(client, "astra")
    active_stories = client.get("/api/v1/stories", cookies=author).json()["items"]
    own_story = next(item for item in active_stories if item["author"]["username"] == "lira")
    other_story = next(item for item in active_stories if item["author"]["username"] != "lira")
    archived_story = client.get(
        "/api/v1/stories", params={"scope": "archive"}, cookies=leadership
    ).json()["items"][0]

    too_long = client.patch(
        f"/api/v1/stories/{own_story['id']}/metadata",
        json={"duration_text": "x" * 65},
        cookies=author,
    )
    forbidden = client.patch(
        f"/api/v1/stories/{other_story['id']}/metadata",
        json={"duration_text": "до 4 минут"},
        cookies=author,
    )
    leadership_updated = client.patch(
        f"/api/v1/stories/{other_story['id']}/metadata",
        json={"duration_text": "до 4 минут"},
        cookies=leadership,
    )
    archived = client.patch(
        f"/api/v1/stories/{archived_story['id']}/metadata",
        json={"duration_text": "до 4 минут"},
        cookies=leadership,
    )

    assert too_long.status_code == 422
    assert too_long.json()["error"]["code"] == "VALIDATION_ERROR"
    assert forbidden.status_code == 403
    assert forbidden.json()["error"]["code"] == "FORBIDDEN"
    assert leadership_updated.status_code == 200, leadership_updated.text
    assert archived.status_code == 409
    assert archived.json()["error"]["code"] == "STORY_ARCHIVED"


def test_story_list_rejects_unknown_scope_and_out_of_range_limit(client) -> None:
    cookies = _cookies(client, "astra")

    bad_scope = client.get("/api/v1/stories", params={"scope": "all"}, cookies=cookies)
    bad_limit = client.get("/api/v1/stories", params={"limit": 201}, cookies=cookies)

    assert bad_scope.status_code == 422
    assert bad_limit.status_code == 422


def test_area_filter_uses_available_assignment_and_external_approval_read_models(client) -> None:
    with SessionLocal() as db:
        story = db.query(Story).filter(Story.title == "Учебный сюжет 01").one()
        editor = db.query(User).filter(User.username == "orion").one()
        db.add(
            StoryAssignment(
                story_id=story.id,
                kind="video_editor",
                user_id=editor.id,
                assigned_by_user_id=editor.id,
            )
        )
        db.commit()
        story_id = story.id

    response = client.get(
        "/api/v1/stories",
        params={"area": "video", "limit": 200},
        cookies=_cookies(client, "astra"),
    )

    assert response.status_code == 200, response.text
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["id"] == story_id


def test_story_address_read_model_is_not_limited_by_list_page_size(client) -> None:
    cookies = _cookies(client, "lira")
    page = client.get("/api/v1/stories", params={"limit": 1}, cookies=cookies)
    all_active = client.get("/api/v1/stories", params={"limit": 200}, cookies=cookies).json()["items"]
    target = next(item for item in all_active if item["id"] != page.json()["items"][0]["id"])

    response = client.get(f"/api/v1/stories/{target['id']}", cookies=cookies)

    assert response.status_code == 200, response.text
    assert response.json()["id"] == target["id"]
