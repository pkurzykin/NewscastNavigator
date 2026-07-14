from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.db.models import (
    Scenario,
    ScenarioEditSession,
    ScenarioRevision,
    ScenarioRevisionRow,
    ScenarioRow,
    Story,
)
from app.db.session import SessionLocal
from app.services.demo_seed import SYNTHETIC_DEMO_PASSWORD, seed_demo_data


SEGMENT_A = "seg_123e4567-e89b-12d3-a456-426614174100"
SEGMENT_B = "seg_123e4567-e89b-12d3-a456-426614174101"
SEGMENT_C = "seg_123e4567-e89b-12d3-a456-426614174102"


@pytest.fixture(autouse=True)
def _seed_synthetic_story() -> None:
    with SessionLocal() as db:
        seed_demo_data(db)


def _login(client, username: str) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": SYNTHETIC_DEMO_PASSWORD},
    )
    assert response.status_code == 200, response.text
    return dict(response.cookies)


def _story_with_initial_scenario() -> int:
    with SessionLocal() as db:
        story = db.query(Story).filter(Story.archived_at.is_(None)).first()
        assert story is not None
        scenario = db.query(Scenario).filter(Scenario.story_id == story.id).one()
        db.add_all(
            [
                ScenarioRow(
                    scenario_id=scenario.id,
                    segment_uid=SEGMENT_A,
                    order_index=1,
                    block_type="zk",
                    text="Исходный первый блок",
                ),
                ScenarioRow(
                    scenario_id=scenario.id,
                    segment_uid=SEGMENT_B,
                    order_index=2,
                    block_type="snh",
                    text="Исходный второй блок",
                    speaker_text="Синтетический спикер",
                ),
            ]
        )
        db.commit()
        return story.id


def _row(segment_uid: str, text: str, *, block_type: str = "zk", order_index: int = 1) -> dict:
    return {
        "segment_uid": segment_uid,
        "order_index": order_index,
        "block_type": block_type,
        "text": text,
        "speaker_text": "",
        "file_name": "",
        "tc_in": "",
        "tc_out": "",
        "additional_comment": "",
        "structured_data": {},
        "formatting": {},
        "rich_text": {},
    }


def _edit_session(client, story_id: int, cookies: dict[str, str], snapshots: list[list[dict]]) -> dict:
    lease_response = client.post(
        f"/api/v1/stories/{story_id}/scenario/lease", json={}, cookies=cookies
    )
    assert lease_response.status_code == 200, lease_response.text
    lease = lease_response.json()
    revision = lease["revision"]
    for index, rows in enumerate(snapshots, start=1):
        response = client.put(
            f"/api/v1/stories/{story_id}/scenario",
            json={
                "base_revision": revision,
                "client_save_id": f"save_session_{lease['edit_session_id']}_{index}",
                "edit_session_id": lease["edit_session_id"],
                "lease_token": lease["lease_token"],
                "rows": rows,
            },
            cookies=cookies,
        )
        assert response.status_code == 200, response.text
        revision = response.json()["revision"]
    released = client.request(
        "DELETE",
        f"/api/v1/stories/{story_id}/scenario/lease",
        json={"edit_session_id": lease["edit_session_id"], "lease_token": lease["lease_token"]},
        cookies=cookies,
    )
    assert released.status_code == 200, released.text
    return {**lease, "revision": revision}


def test_history_groups_autosaves_into_one_persisted_session_diff_and_hides_noop(client) -> None:
    story_id = _story_with_initial_scenario()
    author = _login(client, "lira")
    edited = _edit_session(
        client,
        story_id,
        author,
        [
            [
                _row(SEGMENT_A, "Промежуточная правка", order_index=1),
                _row(SEGMENT_C, "Добавленный блок", order_index=2),
            ],
            [
                _row(SEGMENT_C, "Добавленный блок", order_index=1),
                _row(SEGMENT_A, "Итоговая правка", order_index=2),
            ],
        ],
    )
    _edit_session(client, story_id, author, [])

    response = client.get(f"/api/v1/stories/{story_id}/history", cookies=author)

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["story"]["id"] == story_id
    assert payload["next_cursor"] is None
    assert len(payload["items"]) == 1
    item = payload["items"][0]
    assert item["kind"] == "edit_session"
    assert item["id"] == edited["edit_session_id"]
    assert item["actor"]["username"] == "lira"
    assert item["from_revision"] == 0
    assert item["to_revision"] == 2
    assert item["diff_summary"] == {
        "added": 1,
        "removed": 1,
        "changed": 1,
        "moved": 1,
        "total": 3,
    }
    assert item["diff_href"].endswith(f"/history/edit-sessions/{edited['edit_session_id']}")
    assert item["available_actions"] == []

    detail = client.get(item["diff_href"], cookies=author)
    assert detail.status_code == 200, detail.text
    changes = detail.json()["changes"]
    assert {change["segment_uid"] for change in changes} == {SEGMENT_A, SEGMENT_B, SEGMENT_C}
    assert next(change for change in changes if change["segment_uid"] == SEGMENT_A)["kind"] == "changed"
    assert next(change for change in changes if change["segment_uid"] == SEGMENT_A)["moved"] is True
    assert next(change for change in changes if change["segment_uid"] == SEGMENT_B)["kind"] == "removed"
    assert next(change for change in changes if change["segment_uid"] == SEGMENT_C)["kind"] == "added"

    with SessionLocal() as db:
        scenario = db.query(Scenario).filter(Scenario.story_id == story_id).one()
        revisions = (
            db.query(ScenarioRevision)
            .filter(ScenarioRevision.scenario_id == scenario.id)
            .order_by(ScenarioRevision.revision_no)
            .all()
        )
        assert [revision.revision_no for revision in revisions] == [0, 1, 2]
        assert [
            db.query(ScenarioRevisionRow).filter(ScenarioRevisionRow.revision_id == revision.id).count()
            for revision in revisions
        ] == [2, 0, 2]


def test_restore_is_leadership_only_creates_new_revision_and_keeps_later_history(client) -> None:
    story_id = _story_with_initial_scenario()
    author = _login(client, "lira")
    leadership = _login(client, "astra")
    first = _edit_session(
        client,
        story_id,
        author,
        [[_row(SEGMENT_A, "Состояние первой сессии", order_index=1)]],
    )
    _edit_session(
        client,
        story_id,
        author,
        [[_row(SEGMENT_C, "Более позднее состояние", order_index=1)]],
    )

    forbidden = client.post(
        f"/api/v1/stories/{story_id}/history/edit-sessions/{first['edit_session_id']}/restore",
        json={},
        cookies=author,
    )
    restored = client.post(
        f"/api/v1/stories/{story_id}/history/edit-sessions/{first['edit_session_id']}/restore",
        json={},
        cookies=leadership,
    )

    assert forbidden.status_code == 403
    assert forbidden.json()["error"]["code"] == "FORBIDDEN"
    assert restored.status_code == 200, restored.text
    current = client.get(f"/api/v1/stories/{story_id}/scenario", cookies=author)
    assert current.status_code == 200, current.text
    assert current.json()["scenario"]["revision"] == 3
    assert [(row["segment_uid"], row["text"]) for row in current.json()["scenario"]["rows"]] == [
        (SEGMENT_A, "Состояние первой сессии")
    ]

    history = client.get(f"/api/v1/stories/{story_id}/history", cookies=leadership)
    assert history.status_code == 200, history.text
    assert [item["to_revision"] for item in history.json()["items"]] == [3, 2, 1]
    assert history.json()["items"][0]["actor"]["username"] == "astra"
    assert all(
        [action["code"] for action in item["available_actions"]] == ["restore_scenario_session"]
        for item in history.json()["items"]
    )


def test_history_cursor_is_opaque_and_edit_session_errors_are_domain_specific(client) -> None:
    story_id = _story_with_initial_scenario()
    author = _login(client, "lira")
    leadership = _login(client, "astra")
    for text in ("Первая сессия", "Вторая сессия"):
        _edit_session(client, story_id, author, [[_row(SEGMENT_A, text)]])

    first_page = client.get(
        f"/api/v1/stories/{story_id}/history", params={"limit": 1}, cookies=author
    )
    assert first_page.status_code == 200, first_page.text
    cursor = first_page.json()["next_cursor"]
    assert cursor and not cursor.isdigit()
    second_page = client.get(
        f"/api/v1/stories/{story_id}/history",
        params={"limit": 1, "cursor": cursor},
        cookies=author,
    )
    assert second_page.status_code == 200, second_page.text
    assert second_page.json()["items"][0]["id"] != first_page.json()["items"][0]["id"]

    malformed = client.get(
        f"/api/v1/stories/{story_id}/history",
        params={"cursor": "a"},
        cookies=author,
    )
    assert malformed.status_code == 422
    assert malformed.json()["error"]["code"] == "HISTORY_CURSOR_INVALID"

    missing = client.post(
        f"/api/v1/stories/{story_id}/history/edit-sessions/999999/restore",
        json={},
        cookies=leadership,
    )
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "EDIT_SESSION_NOT_FOUND"

    active_lease = client.post(
        f"/api/v1/stories/{story_id}/scenario/lease", json={}, cookies=author
    ).json()
    no_snapshot = client.post(
        f"/api/v1/stories/{story_id}/history/edit-sessions/{active_lease['edit_session_id']}/restore",
        json={},
        cookies=leadership,
    )
    assert no_snapshot.status_code == 409
    assert no_snapshot.json()["error"]["code"] == "SESSION_HAS_NO_SNAPSHOT"


def test_expired_lease_is_finalized_into_the_same_session_history(client) -> None:
    story_id = _story_with_initial_scenario()
    author = _login(client, "lira")
    lease = client.post(
        f"/api/v1/stories/{story_id}/scenario/lease", json={}, cookies=author
    ).json()
    saved = client.put(
        f"/api/v1/stories/{story_id}/scenario",
        json={
            "base_revision": 0,
            "client_save_id": "save_expired_session",
            "edit_session_id": lease["edit_session_id"],
            "lease_token": lease["lease_token"],
            "rows": [_row(SEGMENT_A, "Правка перед истечением lease")],
        },
        cookies=author,
    )
    assert saved.status_code == 200, saved.text
    with SessionLocal() as db:
        session = db.get(ScenarioEditSession, lease["edit_session_id"])
        assert session is not None
        session.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()

    scenario = client.get(f"/api/v1/stories/{story_id}/scenario", cookies=author)
    history = client.get(f"/api/v1/stories/{story_id}/history", cookies=author)

    assert scenario.status_code == 200, scenario.text
    assert scenario.json()["edit"]["state"] == "available"
    assert history.status_code == 200, history.text
    assert [item["id"] for item in history.json()["items"]] == [lease["edit_session_id"]]


def test_history_get_finalizes_an_expired_lease_without_opening_scenario(client) -> None:
    story_id = _story_with_initial_scenario()
    author = _login(client, "lira")
    lease = client.post(
        f"/api/v1/stories/{story_id}/scenario/lease", json={}, cookies=author
    ).json()
    saved = client.put(
        f"/api/v1/stories/{story_id}/scenario",
        json={
            "base_revision": 0,
            "client_save_id": "save_expired_history",
            "edit_session_id": lease["edit_session_id"],
            "lease_token": lease["lease_token"],
            "rows": [_row(SEGMENT_A, "Правка истёкшей сессии")],
        },
        cookies=author,
    )
    assert saved.status_code == 200, saved.text
    with SessionLocal() as db:
        session = db.get(ScenarioEditSession, lease["edit_session_id"])
        assert session is not None
        session.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()

    history = client.get(f"/api/v1/stories/{story_id}/history", cookies=author)

    assert history.status_code == 200, history.text
    assert [item["id"] for item in history.json()["items"]] == [lease["edit_session_id"]]


def test_restore_supports_an_intentionally_empty_scenario_snapshot(client) -> None:
    story_id = _story_with_initial_scenario()
    author = _login(client, "lira")
    leadership = _login(client, "astra")
    empty = _edit_session(client, story_id, author, [[]])
    _edit_session(
        client,
        story_id,
        author,
        [[_row(SEGMENT_C, "Более поздний непустой сценарий")]],
    )

    restored = client.post(
        f"/api/v1/stories/{story_id}/history/edit-sessions/{empty['edit_session_id']}/restore",
        json={},
        cookies=leadership,
    )

    assert restored.status_code == 200, restored.text
    current = client.get(f"/api/v1/stories/{story_id}/scenario", cookies=author)
    assert current.status_code == 200, current.text
    assert current.json()["scenario"]["rows"] == []


def test_restore_reclaims_an_expired_lease_instead_of_blocking_forever(client) -> None:
    story_id = _story_with_initial_scenario()
    author = _login(client, "lira")
    leadership = _login(client, "astra")
    first = _edit_session(
        client,
        story_id,
        author,
        [[_row(SEGMENT_A, "Состояние для восстановления")]],
    )
    _edit_session(
        client,
        story_id,
        author,
        [[_row(SEGMENT_C, "Более позднее состояние")]],
    )
    expired = client.post(
        f"/api/v1/stories/{story_id}/scenario/lease", json={}, cookies=author
    ).json()
    with SessionLocal() as db:
        session = db.get(ScenarioEditSession, expired["edit_session_id"])
        assert session is not None
        session.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()

    restored = client.post(
        f"/api/v1/stories/{story_id}/history/edit-sessions/{first['edit_session_id']}/restore",
        json={},
        cookies=leadership,
    )

    assert restored.status_code == 200, restored.text
    current = client.get(f"/api/v1/stories/{story_id}/scenario", cookies=author)
    assert current.json()["scenario"]["rows"][0]["text"] == "Состояние для восстановления"
