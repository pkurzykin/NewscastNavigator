from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy.exc import IntegrityError

from app.db.models import Rubric, Story
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


def test_leadership_create_options_expose_canonical_rubric_management_actions(client) -> None:
    leadership = _cookies(client, "iskra")
    with SessionLocal() as db:
        db.add(Rubric(name="Отключённая синтетическая рубрика", is_active=False))
        db.commit()
    options = client.get("/api/v1/stories/create-options", cookies=leadership)

    assert options.status_code == 200, options.text
    management = options.json()["rubric_management"]
    assert management["create_action"] == {
        "code": "rubric_create",
        "label": "Создать рубрику",
        "method": "POST",
        "href": "/api/v1/rubrics",
        "emphasis": "normal",
        "confirmation": None,
        "form": None,
    }
    assert management["items"]
    assert any(not item["is_active"] for item in management["items"])
    assert all(
        item["update_action"]["href"] == f"/api/v1/rubrics/{item['id']}"
        for item in management["items"]
    )
    assert {
        item["id"] for item in options.json()["rubrics"]
    } == {
        item["id"] for item in management["items"] if item["is_active"]
    }
    assert len(options.json()["rubrics"]) == 8
    ordinary = client.get(
        "/api/v1/stories/create-options",
        cookies=_cookies(client, "lira"),
    )
    assert ordinary.json()["rubric_management"] is None


def test_leadership_creates_renames_disables_and_reactivates_rubric(client) -> None:
    leadership = _cookies(client, "iskra")
    created = client.post(
        "/api/v1/rubrics",
        json={"name": "  Новая   синтетическая рубрика  "},
        cookies=leadership,
    )

    assert created.status_code == 200, created.text
    rubric_id = created.json()["resource"]["id"]
    with SessionLocal() as db:
        rubric = db.get(Rubric, rubric_id)
        assert rubric is not None
        assert rubric.name == "Новая синтетическая рубрика"
        assert rubric.is_active is True

    renamed = client.patch(
        f"/api/v1/rubrics/{rubric_id}",
        json={"name": "Обновлённая рубрика", "is_active": False},
        cookies=leadership,
    )
    options_after_disable = client.get(
        "/api/v1/stories/create-options",
        cookies=leadership,
    ).json()

    assert renamed.status_code == 200, renamed.text
    assert rubric_id not in {item["id"] for item in options_after_disable["rubrics"]}
    disabled = next(
        item
        for item in options_after_disable["rubric_management"]["items"]
        if item["id"] == rubric_id
    )
    assert disabled["name"] == "Обновлённая рубрика"
    assert disabled["is_active"] is False

    reactivated = client.patch(
        f"/api/v1/rubrics/{rubric_id}",
        json={"is_active": True},
        cookies=leadership,
    )
    assert reactivated.status_code == 200, reactivated.text
    assert rubric_id in {
        item["id"]
        for item in client.get(
            "/api/v1/stories/create-options",
            cookies=leadership,
        ).json()["rubrics"]
    }


def test_rubric_commands_validate_permissions_uniqueness_and_empty_patch(client) -> None:
    leadership = _cookies(client, "astra")
    ordinary = _cookies(client, "lira")
    options = client.get("/api/v1/stories/create-options", cookies=leadership).json()
    existing = options["rubrics"][0]

    duplicate = client.post(
        "/api/v1/rubrics",
        json={"name": f"  {existing['name'].swapcase()}  "},
        cookies=leadership,
    )
    blank = client.post(
        "/api/v1/rubrics",
        json={"name": "   "},
        cookies=leadership,
    )
    empty = client.patch(
        f"/api/v1/rubrics/{existing['id']}",
        json={},
        cookies=leadership,
    )
    missing = client.patch(
        "/api/v1/rubrics/999999",
        json={"name": "Не найдено"},
        cookies=leadership,
    )
    forbidden_create = client.post(
        "/api/v1/rubrics",
        json={"name": "Запрещённая рубрика"},
        cookies=ordinary,
    )
    forbidden_update = client.patch(
        f"/api/v1/rubrics/{existing['id']}",
        json={"is_active": False},
        cookies=ordinary,
    )

    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "RUBRIC_NAME_TAKEN"
    assert blank.status_code == 422
    assert blank.json()["error"]["code"] == "VALIDATION_ERROR"
    assert empty.status_code == 400
    assert empty.json()["error"]["code"] == "EMPTY_PATCH"
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "RUBRIC_NOT_FOUND"
    for response in (forbidden_create, forbidden_update):
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "FORBIDDEN"


def test_disabled_used_rubric_remains_readable_but_is_not_offered_for_reassignment(client) -> None:
    leadership = _cookies(client, "astra")
    story = client.get("/api/v1/stories", cookies=leadership).json()["items"][0]
    disabled = client.patch(
        f"/api/v1/rubrics/{story['rubric']['id']}",
        json={"is_active": False},
        cookies=leadership,
    )

    assert disabled.status_code == 200, disabled.text
    reread = client.get(f"/api/v1/stories/{story['id']}", cookies=leadership).json()
    options = client.get("/api/v1/stories/create-options", cookies=leadership).json()
    scenario = client.get(
        f"/api/v1/stories/{story['id']}/scenario",
        cookies=leadership,
    ).json()

    assert reread["rubric"] == story["rubric"]
    assert story["rubric"]["id"] not in {item["id"] for item in options["rubrics"]}
    assert story["rubric"]["id"] not in {
        item["id"] for item in scenario["metadata"]["rubrics"]
    }
    with SessionLocal() as db:
        assert db.get(Story, story["id"]).rubric_id == story["rubric"]["id"]


def test_rubric_casefold_key_is_an_orm_and_database_unique_invariant() -> None:
    with SessionLocal() as db:
        original = Rubric(name="Синтетическая РУБРИКА", is_active=True)
        db.add(original)
        db.commit()

        assert original.name_key == "синтетическая рубрика"
        duplicate = Rubric(name="  синтетическая   рубрика  ", is_active=True)
        db.add(duplicate)
        with pytest.raises(IntegrityError):
            db.commit()


def test_concurrent_rubric_create_returns_one_success_and_one_canonical_conflict(client) -> None:
    cookies = _cookies(client, "astra")

    def create(name: str) -> tuple[int, str | None]:
        response = client.post(
            "/api/v1/rubrics",
            json={"name": name},
            cookies=cookies,
        )
        error = response.json().get("error", {})
        return response.status_code, error.get("code")

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(
            executor.map(
                create,
                ("Параллельная Рубрика", "параллельная рубрика"),
            )
        )

    assert sorted(results) == [(200, None), (409, "RUBRIC_NAME_TAKEN")]


def test_concurrent_rubric_rename_returns_one_success_and_one_canonical_conflict(client) -> None:
    cookies = _cookies(client, "astra")
    first = client.post(
        "/api/v1/rubrics",
        json={"name": "Первая параллельная"},
        cookies=cookies,
    ).json()["resource"]["id"]
    second = client.post(
        "/api/v1/rubrics",
        json={"name": "Вторая параллельная"},
        cookies=cookies,
    ).json()["resource"]["id"]

    def rename(rubric_id: int) -> tuple[int, str | None]:
        response = client.patch(
            f"/api/v1/rubrics/{rubric_id}",
            json={"name": "ОБЩЕЕ имя"},
            cookies=cookies,
        )
        error = response.json().get("error", {})
        return response.status_code, error.get("code")

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(rename, (first, second)))

    assert sorted(results) == [(200, None), (409, "RUBRIC_NAME_TAKEN")]
