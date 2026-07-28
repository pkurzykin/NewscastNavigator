from __future__ import annotations

import pytest

from app.db.models import Story, StoryAssignment, User
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
    assert story["priority_action"] is None


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
    assert story["priority_action"] == {
        "code": "story_priority_update",
        "label": "Изменить приоритет",
        "method": "PATCH",
        "href": f"/api/v1/stories/{story_id}/management",
        "emphasis": "normal",
        "confirmation": None,
        "form": None,
    }
    changed = client.patch(
        story["priority_action"]["href"],
        json={"priority": "standard"},
        cookies=cookies,
    )

    assert changed.status_code == 200, changed.text
    assert (
        client.get(f"/api/v1/stories/{story_id}", cookies=cookies).json()["priority"]["code"]
        == "standard"
    )


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
