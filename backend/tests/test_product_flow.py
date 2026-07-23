from __future__ import annotations

from uuid import uuid4

import pytest

from app.db.models import Rubric
from app.db.session import SessionLocal
from app.services.demo_seed import SYNTHETIC_DEMO_PASSWORD, seed_demo_data


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


def test_synthetic_product_flow_uses_only_public_commands_after_creation(client) -> None:
    author = _login(client, "lira")
    leadership = _login(client, "astra")
    reader = _login(client, "sfera")
    with SessionLocal() as db:
        rubric_id = (
            db.query(Rubric)
            .filter(Rubric.is_active.is_(True))
            .order_by(Rubric.id)
            .first()
            .id
        )

    created = client.post(
        "/api/v1/stories",
        json={"title": "Синтетический полный путь", "rubric_id": rubric_id},
        cookies=author,
    )
    assert created.status_code == 200, created.text
    story_id = created.json()["resource"]["id"]

    lease = client.post(
        f"/api/v1/stories/{story_id}/scenario/lease",
        json={},
        cookies=author,
    )
    assert lease.status_code == 200, lease.text
    save = client.put(
        f"/api/v1/stories/{story_id}/scenario",
        json={
            "base_revision": 0,
            "client_save_id": uuid4().hex,
            "edit_session_id": lease.json()["edit_session_id"],
            "lease_token": lease.json()["lease_token"],
            "rows": [
                {
                    "segment_uid": f"seg_{uuid4()}",
                    "order_index": 1,
                    "block_type": "zk",
                    "text": "Синтетический текст полного пути",
                }
            ],
        },
        cookies=author,
    )
    assert save.status_code == 200, save.text
    assert save.json()["revision"] == 1
    released = client.request(
        "DELETE",
        f"/api/v1/stories/{story_id}/scenario/lease",
        json={
            "edit_session_id": lease.json()["edit_session_id"],
            "lease_token": lease.json()["lease_token"],
        },
        cookies=author,
    )
    assert released.status_code == 200, released.text

    sent = client.post(
        f"/api/v1/stories/{story_id}/external-approval/cycles/send",
        json={},
        cookies=leadership,
    )
    assert sent.status_code == 200, sent.text
    cycle_id = sent.json()["resource"]["id"]
    approved = client.post(
        f"/api/v1/stories/{story_id}/external-approval/cycles/{cycle_id}/approved",
        json={},
        cookies=leadership,
    )
    assert approved.status_code == 200, approved.text
    aired = client.post(
        f"/api/v1/stories/{story_id}/production/mark-aired",
        json={},
        cookies=leadership,
    )
    assert aired.status_code == 200, aired.text

    # The aired mark remains visual: a new lease and current-scenario save are still valid.
    second_lease = client.post(
        f"/api/v1/stories/{story_id}/scenario/lease",
        json={},
        cookies=reader,
    )
    assert second_lease.status_code == 200, second_lease.text
    second_save = client.put(
        f"/api/v1/stories/{story_id}/scenario",
        json={
            "base_revision": 1,
            "client_save_id": uuid4().hex,
            "edit_session_id": second_lease.json()["edit_session_id"],
            "lease_token": second_lease.json()["lease_token"],
            "rows": [
                {
                    "segment_uid": f"seg_{uuid4()}",
                    "order_index": 1,
                    "block_type": "zk",
                    "text": "Синтетический текст после эфира",
                }
            ],
        },
        cookies=reader,
    )
    assert second_save.status_code == 200, second_save.text
    assert second_save.json()["revision"] == 2

    archived = client.post(
        f"/api/v1/stories/{story_id}/archive",
        json={},
        cookies=leadership,
    )
    assert archived.status_code == 200, archived.text
    archived_scenario = client.get(
        f"/api/v1/stories/{story_id}/scenario",
        cookies=reader,
    )
    assert archived_scenario.status_code == 200, archived_scenario.text
    assert archived_scenario.json()["edit"]["state"] == "archived"
    assert archived_scenario.json()["scenario"]["revision"] == 2
    assert archived_scenario.json()["scenario"]["rows"][0]["text"] == (
        "Синтетический текст после эфира"
    )
    blocked = client.post(
        f"/api/v1/stories/{story_id}/scenario/lease",
        json={},
        cookies=reader,
    )
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "STORY_ARCHIVED"

    restored = client.post(
        f"/api/v1/stories/{story_id}/restore",
        json={},
        cookies=leadership,
    )
    assert restored.status_code == 200, restored.text
    restored_story = client.get(
        f"/api/v1/stories/{story_id}",
        cookies=reader,
    )
    assert restored_story.status_code == 200
    assert restored_story.json()["archived_at"] is None
    assert restored_story.json()["situation"] == {
        "code": "aired",
        "label": "Вышел в эфир",
    }
    restored_scenario = client.get(
        f"/api/v1/stories/{story_id}/scenario",
        cookies=reader,
    )
    assert restored_scenario.status_code == 200
    assert restored_scenario.json()["scenario"]["revision"] == 2
    assert restored_scenario.json()["edit"]["state"] == "available"
