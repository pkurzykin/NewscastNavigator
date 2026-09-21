from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.db.models import Scenario, ScenarioRow, Story
from app.db.session import SessionLocal
from app.services.demo_seed import SYNTHETIC_DEMO_PASSWORD, seed_demo_data
from app.services.story_activity import touch_story_activity


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


def test_story_activity_timestamp_never_moves_backward() -> None:
    story_id = _active_story_id()
    newer = datetime(2030, 1, 2, 12, 0, tzinfo=UTC)
    older = datetime(2030, 1, 2, 11, 0, tzinfo=UTC)

    with SessionLocal() as db:
        touch_story_activity(db, story_id=story_id, changed_at=newer)
        db.commit()

    with SessionLocal() as db:
        touch_story_activity(db, story_id=story_id, changed_at=older)
        db.commit()
        story = db.get(Story, story_id)
        assert story is not None
        assert story.updated_at.hour == 12


@pytest.mark.parametrize("empty", [False, True])
def test_default_font_is_atomic_immutable_and_part_of_retry_identity(client, empty) -> None:
    from app.db.models import ScenarioRevision
    story_id = _active_story_id()
    cookies = _login(client)
    path = f"/api/v1/stories/{story_id}/scenario"
    lease = client.post(f"{path}/lease", json={}, cookies=cookies).json()
    rows = [] if empty else [{"segment_uid": "seg_123e4567-e89b-12d3-a456-426614174099", "order_index": 1, "block_type": "zk", "text": "Текст", "formatting": {"targets": {"text": {"font_family": "PT Sans"}}}}]
    payload = {"base_revision": 0, "client_save_id": "font_1", "edit_session_id": lease["edit_session_id"], "lease_token": lease["lease_token"], "rows": rows, "default_font_family": "Franklin Gothic Book"}
    first = client.put(path, json=payload, cookies=cookies)
    assert first.status_code == 200, first.text
    current = client.get(path, cookies=cookies).json()["scenario"]
    assert current.get("default_font_family") == "Franklin Gothic Book"
    assert client.put(path, json=payload, cookies=cookies).json() == first.json()
    reused = client.put(path, json={**payload, "default_font_family": "PT Sans"}, cookies=cookies)
    assert reused.status_code == 409
    assert reused.json()["error"]["code"] == "SCENARIO_SAVE_ID_REUSED"
    second = client.put(path, json={**payload, "base_revision": 1, "client_save_id": "font_2", "default_font_family": "PT Sans"}, cookies=cookies)
    assert second.status_code == 200
    assert second.json()["revision"] == 2
    assert client.get(path, cookies=cookies).json()["scenario"]["rows"] == current["rows"]
    with SessionLocal() as db:
        scenario = db.query(Scenario).filter_by(story_id=story_id).one()
        revisions = db.query(ScenarioRevision).filter_by(scenario_id=scenario.id).order_by(ScenarioRevision.revision_no).all()
        assert [r.default_font_family for r in revisions] == ["PT Sans", "Franklin Gothic Book", "PT Sans"]
    invalid = client.put(path, json={**payload, "default_font_family": "Arial"}, cookies=cookies)
    assert invalid.status_code == 422


def test_font_only_session_diff_compaction_and_restore(client) -> None:
    story_id = _active_story_id()
    cookies = _login(client, "astra")
    path = f"/api/v1/stories/{story_id}/scenario"
    lease_response = client.post(f"{path}/lease", json={}, cookies=cookies)
    assert lease_response.status_code == 200, lease_response.text
    lease = lease_response.json()
    current = client.get(path, cookies=cookies).json()["scenario"]
    payload = {"base_revision": 0, "client_save_id": "font_history_1", "edit_session_id": lease["edit_session_id"], "lease_token": lease["lease_token"], "rows": current["rows"], "default_font_family": "Franklin Gothic Book"}
    assert client.put(path, json=payload, cookies=cookies).status_code == 200
    assert client.put(path, json={**payload, "base_revision": 1, "client_save_id": "font_history_2"}, cookies=cookies).status_code == 200
    release = client.request("DELETE", f"{path}/lease", json={"edit_session_id": lease["edit_session_id"], "lease_token": lease["lease_token"]}, cookies=cookies)
    assert release.status_code == 200, release.text
    diff = client.get(f"/api/v1/stories/{story_id}/history/edit-sessions/{lease['edit_session_id']}", cookies=cookies)
    assert diff.status_code == 200, diff.text
    data = diff.json()
    assert data["session"]["diff_summary"].get("settings_changed") == 1
    assert data["session"]["diff_summary"]["total"] == 1
    assert data["changes"] == []
    assert data["default_font_family"] == {"before": "PT Sans", "after": "Franklin Gothic Book"}
    retry = client.put(path, json=payload, cookies=cookies)
    assert retry.status_code == 200, retry.text
    wrong_font = client.put(path, json={**payload, "default_font_family": "PT Sans"}, cookies=cookies)
    assert wrong_font.status_code == 409
    lease2 = client.post(f"{path}/lease", json={}, cookies=cookies).json()
    credentials = {"edit_session_id": lease2["edit_session_id"], "lease_token": lease2["lease_token"]}
    assert client.put(path, json={**payload, **credentials, "base_revision": 2, "client_save_id": "font_history_3", "default_font_family": "PT Sans"}, cookies=cookies).status_code == 200
    assert client.request("DELETE", f"{path}/lease", json=credentials, cookies=cookies).status_code == 200
    restore = client.post(f"/api/v1/stories/{story_id}/history/edit-sessions/{lease['edit_session_id']}/restore", json={}, cookies=cookies)
    assert restore.status_code == 200, restore.text
    assert client.get(path, cookies=cookies).json()["scenario"]["default_font_family"] == "Franklin Gothic Book"


def test_restore_identical_snapshot_has_no_revision_session_or_event(client):
    from app.db.models import ScenarioEditSession, ScenarioRevision, StoryEvent
    story_id = _active_story_id()
    cookies = _login(client, "astra")
    path = f"/api/v1/stories/{story_id}/scenario"
    lease = client.post(f"{path}/lease", json={}, cookies=cookies).json()
    credentials = {"edit_session_id": lease["edit_session_id"], "lease_token": lease["lease_token"]}
    saved = client.put(path, json={**credentials, "base_revision": 0, "client_save_id": "font_noop", "rows": [], "default_font_family": "Franklin Gothic Book"}, cookies=cookies)
    assert saved.status_code == 200
    assert client.request("DELETE", f"{path}/lease", json=credentials, cookies=cookies).status_code == 200
    def counts():
        with SessionLocal() as db:
            return tuple(db.query(model).count() for model in (ScenarioRevision, ScenarioEditSession, StoryEvent))
    before = counts()
    response = client.post(f"/api/v1/stories/{story_id}/history/edit-sessions/{lease['edit_session_id']}/restore", json={}, cookies=cookies)
    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "SCENARIO_ALREADY_CURRENT"
    assert counts() == before
    assert client.get(path, cookies=cookies).json()["scenario"]["revision"] == 1
