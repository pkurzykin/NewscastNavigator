from __future__ import annotations

import pytest

from app.db.models import Scenario, ScenarioRow, Story
from app.db.session import SessionLocal
from app.services.demo_seed import SYNTHETIC_DEMO_PASSWORD, seed_demo_data


@pytest.fixture(autouse=True)
def _seed_synthetic_story() -> None:
    with SessionLocal() as db:
        seed_demo_data(db)


def _login(client, username: str = "lira") -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": SYNTHETIC_DEMO_PASSWORD},
    )
    assert response.status_code == 200, response.text
    return dict(response.cookies)


def _active_story_id() -> int:
    with SessionLocal() as db:
        story = db.query(Story).filter(Story.archived_at.is_(None)).first()
        assert story is not None
        scenario = db.query(Scenario).filter(Scenario.story_id == story.id).one()
        assert scenario.revision_no == 0
        return story.id


def test_scenario_save_returns_ack_only_after_owner_acquires_lease(client) -> None:
    story_id = _active_story_id()
    cookies = _login(client)

    lease = client.post(f"/api/v1/stories/{story_id}/scenario/lease", json={}, cookies=cookies)

    assert lease.status_code == 200, lease.text
    lease_payload = lease.json()
    assert lease_payload["revision"] == 0
    assert lease_payload["edit_session_id"]
    assert lease_payload["lease_token"]

    saved = client.put(
        f"/api/v1/stories/{story_id}/scenario",
        json={
            "base_revision": 0,
            "client_save_id": "save_00000001",
            "edit_session_id": lease_payload["edit_session_id"],
            "lease_token": lease_payload["lease_token"],
            "rows": [
                {
                    "segment_uid": "seg_123e4567-e89b-12d3-a456-426614174000",
                    "order_index": 1,
                    "block_type": "zk",
                    "text": "Актуальный синтетический текст",
                    "speaker_text": "",
                    "file_name": "",
                    "tc_in": "",
                    "tc_out": "",
                    "additional_comment": "",
                    "structured_data": {},
                    "formatting": {},
                    "rich_text": {},
                }
            ],
        },
        cookies=cookies,
    )

    assert saved.status_code == 200, saved.text
    assert saved.json() == {
        "ok": True,
        "client_save_id": "save_00000001",
        "revision": 1,
        "saved_at": saved.json()["saved_at"],
    }


def test_new_scenario_save_updates_story_activity_but_idempotent_retry_does_not(client) -> None:
    story_id = _active_story_id()
    cookies = _login(client)
    lease = client.post(
        f"/api/v1/stories/{story_id}/scenario/lease",
        json={},
        cookies=cookies,
    ).json()
    payload = {
        "base_revision": 0,
        "client_save_id": "save_activity_0001",
        "edit_session_id": lease["edit_session_id"],
        "lease_token": lease["lease_token"],
        "rows": [
            {
                "segment_uid": "seg_123e4567-e89b-12d3-a456-426614174099",
                "order_index": 1,
                "block_type": "zk",
                "text": "Содержательная правка",
            }
        ],
    }
    before = client.get(
        f"/api/v1/stories/{story_id}",
        cookies=cookies,
    ).json()["updated_at"]

    first = client.put(
        f"/api/v1/stories/{story_id}/scenario",
        json=payload,
        cookies=cookies,
    )
    after_first = client.get(
        f"/api/v1/stories/{story_id}",
        cookies=cookies,
    ).json()["updated_at"]
    retry = client.put(
        f"/api/v1/stories/{story_id}/scenario",
        json=payload,
        cookies=cookies,
    )
    after_retry = client.get(
        f"/api/v1/stories/{story_id}",
        cookies=cookies,
    ).json()["updated_at"]

    assert first.status_code == 200, first.text
    assert retry.status_code == 200, retry.text
    assert after_first > before
    assert after_retry == after_first


def test_scenario_read_model_returns_current_rows_revision_and_available_edit_state(client) -> None:
    story_id = _active_story_id()
    with SessionLocal() as db:
        scenario = db.query(Scenario).filter(Scenario.story_id == story_id).one()
        db.add(
            ScenarioRow(
                scenario_id=scenario.id,
                segment_uid="seg_123e4567-e89b-12d3-a456-426614174010",
                order_index=1,
                block_type="zk",
                text="Сохранённый синтетический текст",
            )
        )
        db.commit()

    response = client.get(f"/api/v1/stories/{story_id}/scenario", cookies=_login(client))

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["story"]["id"] == story_id
    assert payload["scenario"]["revision"] == 0
    assert payload["scenario"]["rows"][0]["segment_uid"] == "seg_123e4567-e89b-12d3-a456-426614174010"
    assert payload["scenario"]["rows"][0]["text"] == "Сохранённый синтетический текст"
    assert payload["edit"]["state"] == "available"
    assert [item["name"] for item in payload["metadata"]["rubrics"]] == [
        "Новости",
        "Специальный репортаж",
        "Транснефть помогает",
        "Волонтеры Транснефти",
        "Люди компании",
        "Новость дня",
        "Оптимум",
        "Спорт",
    ]


def test_scenario_save_retries_idempotently_and_rejects_stale_revision(client) -> None:
    story_id = _active_story_id()
    cookies = _login(client)
    lease = client.post(f"/api/v1/stories/{story_id}/scenario/lease", json={}, cookies=cookies).json()
    payload = {
        "base_revision": 0,
        "client_save_id": "save_00000002",
        "edit_session_id": lease["edit_session_id"],
        "lease_token": lease["lease_token"],
        "rows": [
            {
                "segment_uid": "seg_123e4567-e89b-12d3-a456-426614174001",
                "order_index": 1,
                "block_type": "zk",
                "text": "Первая подтверждённая правка",
            }
        ],
    }

    accepted = client.put(f"/api/v1/stories/{story_id}/scenario", json=payload, cookies=cookies)
    retried = client.put(f"/api/v1/stories/{story_id}/scenario", json=payload, cookies=cookies)
    stale = client.put(
        f"/api/v1/stories/{story_id}/scenario",
        json={**payload, "client_save_id": "save_00000003", "rows": []},
        cookies=cookies,
    )

    assert accepted.status_code == 200, accepted.text
    assert retried.status_code == 200, retried.text
    assert retried.json() == accepted.json()
    assert stale.status_code == 409, stale.text
    assert stale.json()["error"]["code"] == "SCENARIO_REVISION_CONFLICT"


def test_scenario_rejects_invalid_block_type_before_database_write(client) -> None:
    story_id = _active_story_id()
    cookies = _login(client)
    lease = client.post(f"/api/v1/stories/{story_id}/scenario/lease", json={}, cookies=cookies).json()

    invalid = client.put(
        f"/api/v1/stories/{story_id}/scenario",
        json={
            "base_revision": 0,
            "client_save_id": "save_00000004",
            "edit_session_id": lease["edit_session_id"],
            "lease_token": lease["lease_token"],
            "rows": [
                {
                    "segment_uid": "seg_123e4567-e89b-12d3-a456-426614174002",
                    "order_index": 1,
                    "block_type": "invalid",
                }
            ],
        },
        cookies=cookies,
    )

    assert invalid.status_code == 422, invalid.text
    assert invalid.json()["error"]["code"] == "VALIDATION_ERROR"


def test_scenario_rejects_malformed_segment_uid_with_domain_error(client) -> None:
    story_id = _active_story_id()
    cookies = _login(client)
    lease = client.post(f"/api/v1/stories/{story_id}/scenario/lease", json={}, cookies=cookies).json()

    invalid = client.put(
        f"/api/v1/stories/{story_id}/scenario",
        json={
            "base_revision": 0,
            "client_save_id": "save_00000006",
            "edit_session_id": lease["edit_session_id"],
            "lease_token": lease["lease_token"],
            "rows": [{"segment_uid": "not-a-segment", "order_index": 1, "block_type": "zk"}],
        },
        cookies=cookies,
    )

    assert invalid.status_code == 422, invalid.text
    assert invalid.json()["error"]["code"] == "SEGMENT_UID_INVALID"


def test_scenario_rejects_reused_save_id_for_different_snapshot(client) -> None:
    story_id = _active_story_id()
    cookies = _login(client)
    lease = client.post(f"/api/v1/stories/{story_id}/scenario/lease", json={}, cookies=cookies).json()
    payload = {
        "base_revision": 0,
        "client_save_id": "save_00000005",
        "edit_session_id": lease["edit_session_id"],
        "lease_token": lease["lease_token"],
        "rows": [
            {
                "segment_uid": "seg_123e4567-e89b-12d3-a456-426614174003",
                "order_index": 1,
                "block_type": "zk",
                "text": "Исходный снимок",
            }
        ],
    }
    accepted = client.put(f"/api/v1/stories/{story_id}/scenario", json=payload, cookies=cookies)
    collision = client.put(
        f"/api/v1/stories/{story_id}/scenario",
        json={
            **payload,
            "rows": [{**payload["rows"][0], "text": "Другой снимок"}],
        },
        cookies=cookies,
    )

    assert accepted.status_code == 200, accepted.text
    assert collision.status_code == 409, collision.text
    assert collision.json()["error"]["code"] == "SCENARIO_SAVE_ID_REUSED"
