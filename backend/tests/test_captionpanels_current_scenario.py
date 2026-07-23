from __future__ import annotations

from typing import Any

import pytest

from app.core.security import hash_password
from app.db.models import (
    Notification,
    Rubric,
    Scenario,
    ScenarioReadMarker,
    Story,
    StoryProductionState,
    StoryWorkflowState,
    User,
    UserFunction,
)
from app.db.session import SessionLocal, engine
from tests.sql_lock_order import (
    SqlTraceStatement,
    assert_exact_aggregate_locks_before_mutation,
    capture_sql,
)


PASSWORD = "Caption-Current-2026!"
CAPTIONPANELS_MUTATION_TABLES = (
    "scenario_read_markers",
    "scenario_edit_sessions",
)


def _canonical_aggregate_locks() -> list[SqlTraceStatement]:
    return [
        SqlTraceStatement.locked_table("stories"),
        SqlTraceStatement.locked_table("scenarios"),
        SqlTraceStatement.locked_table("story_workflow_states"),
        SqlTraceStatement.locked_table("story_production_states"),
    ]


def _mutation(table: str, operation: str = "insert") -> SqlTraceStatement:
    return SqlTraceStatement(
        sql=f"{operation} {table}",
        for_update=False,
        mutation_target_tables=(table,),
    )


def _create_story(*, username: str = "caption-current", title: str = "Синтетический эфир") -> int:
    with SessionLocal() as db:
        user = User(
            username=username,
            display_name="Тестовый дизайнер",
            position="Дизайнер",
            password_hash=hash_password(PASSWORD),
            is_active=True,
            must_change_password=False,
            functions=[UserFunction(function_code="designer")],
        )
        rubric = Rubric(name=f"Рубрика {username}", is_active=True)
        db.add_all([user, rubric])
        db.flush()
        story = Story(title=title, rubric_id=rubric.id, author_user_id=user.id)
        db.add(story)
        db.flush()
        db.add_all(
            [
                Scenario(story_id=story.id),
                StoryWorkflowState(story_id=story.id),
                StoryProductionState(story_id=story.id),
            ]
        )
        db.commit()
        return story.id


def _login(client, username: str = "caption-current") -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": PASSWORD},
    )
    assert response.status_code == 200, response.text


def _row(segment_uid: str, text: str) -> dict[str, Any]:
    return {
        "segment_uid": segment_uid,
        "order_index": 1,
        "block_type": "zk",
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


def _save_and_finish_session(
    client,
    *,
    story_id: int,
    base_revision: int,
    client_save_id: str,
    segment_uid: str,
    text: str,
) -> tuple[int, int]:
    lease_response = client.post(f"/api/v1/stories/{story_id}/scenario/lease", json={})
    assert lease_response.status_code == 200, lease_response.text
    lease = lease_response.json()
    saved = client.put(
        f"/api/v1/stories/{story_id}/scenario",
        json={
            "base_revision": base_revision,
            "client_save_id": client_save_id,
            "edit_session_id": lease["edit_session_id"],
            "lease_token": lease["lease_token"],
            "rows": [_row(segment_uid, text)],
        },
    )
    assert saved.status_code == 200, saved.text
    released = client.request(
        "DELETE",
        f"/api/v1/stories/{story_id}/scenario/lease",
        json={
            "edit_session_id": lease["edit_session_id"],
            "lease_token": lease["lease_token"],
        },
    )
    assert released.status_code == 200, released.text
    return saved.json()["revision"], lease["edit_session_id"]


def _contains_key(value: Any, forbidden_key: str) -> bool:
    if isinstance(value, dict):
        return forbidden_key in value or any(_contains_key(item, forbidden_key) for item in value.values())
    if isinstance(value, list):
        return any(_contains_key(item, forbidden_key) for item in value)
    return False


def test_captionpanels_returns_latest_scenario_with_stable_ids_and_marks_exact_revision(client) -> None:
    story_id = _create_story()
    _login(client)
    segment_uid = "seg_00000000-0000-4000-8000-000000000341"
    revision_a, _session_a = _save_and_finish_session(
        client,
        story_id=story_id,
        base_revision=0,
        client_save_id="caption_current_a",
        segment_uid=segment_uid,
        text="Редакция А",
    )

    first_response = client.get(
        f"/api/v1/integrations/captionpanels/stories/{story_id}/import-json"
    )

    assert first_response.status_code == 200, first_response.text
    first_payload = first_response.json()
    assert first_payload["segments"] == [
        {"id": segment_uid, "type": "voiceover", "text": "Редакция А"}
    ]
    assert not _contains_key(first_payload, "text_seq")
    with SessionLocal() as db:
        marker = db.query(ScenarioReadMarker).filter_by(
            story_id=story_id,
            context="captionpanels",
        ).one()
        assert marker.revision_no == revision_a

    revision_b, session_b = _save_and_finish_session(
        client,
        story_id=story_id,
        base_revision=revision_a,
        client_save_id="caption_current_b",
        segment_uid=segment_uid,
        text="Редакция Б",
    )
    status_before_open = client.get(f"/api/v1/stories/{story_id}/scenario")
    second_response = client.get(
        f"/api/v1/integrations/captionpanels/stories/{story_id}/import-json"
    )

    assert status_before_open.status_code == 200, status_before_open.text
    assert status_before_open.json()["captionpanels"] == {
        "eligible": True,
        "last_opened_revision": revision_a,
        "changed_since_last_open": True,
        "diff_session_id": session_b,
    }
    assert second_response.status_code == 200, second_response.text
    second_payload = second_response.json()
    assert second_payload["segments"] == [
        {"id": segment_uid, "type": "voiceover", "text": "Редакция Б"}
    ]
    assert second_payload["segments"][0]["id"] == first_payload["segments"][0]["id"]
    assert not _contains_key(second_payload, "text_seq")
    with SessionLocal() as db:
        marker = db.query(ScenarioReadMarker).filter_by(
            story_id=story_id,
            context="captionpanels",
        ).one()
        assert marker.revision_no == revision_b

    status_after_open = client.get(f"/api/v1/stories/{story_id}/scenario")
    assert status_after_open.status_code == 200, status_after_open.text
    assert status_after_open.json()["captionpanels"] == {
        "eligible": True,
        "last_opened_revision": revision_b,
        "changed_since_last_open": False,
        "diff_session_id": None,
    }

    _create_story(username="caption-observer", title="Наблюдательский синтетический сюжет")
    _login(client, "caption-observer")
    observer_status = client.get(f"/api/v1/stories/{story_id}/scenario")
    assert observer_status.status_code == 200, observer_status.text
    assert observer_status.json()["captionpanels"] == {
        "eligible": True,
        "last_opened_revision": None,
        "changed_since_last_open": False,
        "diff_session_id": None,
    }


def test_captionpanels_import_locks_aggregate_before_read_marker_mutation(client) -> None:
    story_id = _create_story()
    _login(client)
    response = None

    def import_current_scenario() -> None:
        nonlocal response
        response = client.get(
            f"/api/v1/integrations/captionpanels/stories/{story_id}/import-json"
        )

    statements = capture_sql(engine, import_current_scenario)

    assert response is not None
    assert response.status_code == 200, response.text
    assert_exact_aggregate_locks_before_mutation(
        statements,
        mutation_tables=CAPTIONPANELS_MUTATION_TABLES,
    )


@pytest.mark.parametrize(
    "subordinate_table",
    ["scenario_edit_sessions", "scenario_read_markers"],
)
def test_captionpanels_lock_guard_rejects_subordinate_lock_before_aggregate(
    subordinate_table: str,
) -> None:
    statements = [
        SqlTraceStatement.locked_table(subordinate_table),
        *_canonical_aggregate_locks(),
        _mutation("scenario_read_markers"),
    ]

    with pytest.raises(AssertionError):
        assert_exact_aggregate_locks_before_mutation(
            statements,
            mutation_tables=CAPTIONPANELS_MUTATION_TABLES,
        )


@pytest.mark.parametrize(
    "mutation_table",
    ["scenario_read_markers", "scenario_edit_sessions"],
)
def test_captionpanels_lock_guard_rejects_subordinate_mutation_before_aggregate(
    mutation_table: str,
) -> None:
    statements = [
        _mutation(mutation_table),
        *_canonical_aggregate_locks(),
        _mutation("scenario_read_markers"),
    ]

    with pytest.raises(AssertionError):
        assert_exact_aggregate_locks_before_mutation(
            statements,
            mutation_tables=CAPTIONPANELS_MUTATION_TABLES,
        )


@pytest.mark.parametrize(
    "aggregate_locks",
    [
        pytest.param(
            [
                SqlTraceStatement.locked_table("stories"),
                SqlTraceStatement.locked_table("scenarios"),
                SqlTraceStatement.locked_table("story_workflow_states"),
            ],
            id="missing-production",
        ),
        pytest.param(
            [
                SqlTraceStatement.locked_table("scenarios"),
                SqlTraceStatement.locked_table("stories"),
                SqlTraceStatement.locked_table("story_workflow_states"),
                SqlTraceStatement.locked_table("story_production_states"),
            ],
            id="reordered-story-scenario",
        ),
        pytest.param(
            [
                *_canonical_aggregate_locks(),
                SqlTraceStatement.locked_table("stories"),
            ],
            id="aggregate-relock",
        ),
    ],
)
def test_captionpanels_lock_guard_rejects_noncanonical_aggregate_sequence(
    aggregate_locks: list[SqlTraceStatement],
) -> None:
    statements = [*aggregate_locks, _mutation("scenario_read_markers")]

    with pytest.raises(AssertionError):
        assert_exact_aggregate_locks_before_mutation(
            statements,
            mutation_tables=CAPTIONPANELS_MUTATION_TABLES,
        )


@pytest.mark.parametrize("operation", ["insert", "update"])
def test_captionpanels_lock_guard_allows_marker_mutation_after_aggregate(
    operation: str,
) -> None:
    statements = [
        *_canonical_aggregate_locks(),
        _mutation("scenario_read_markers", operation),
    ]

    assert_exact_aggregate_locks_before_mutation(
        statements,
        mutation_tables=CAPTIONPANELS_MUTATION_TABLES,
    )


def test_captionpanels_import_reads_matching_titles_notification_but_not_a_newer_revision(client) -> None:
    story_id = _create_story()
    _login(client)
    revision, _session_id = _save_and_finish_session(
        client,
        story_id=story_id,
        base_revision=0,
        client_save_id="caption_notification_read",
        segment_uid="seg_00000000-0000-4000-8000-000000000349",
        text="Актуальная редакция для CaptionPanels",
    )
    with SessionLocal() as db:
        recipient = db.query(User).filter(User.username == "caption-current").one()
        matching = Notification(
            recipient_user_id=recipient.id,
            story_id=story_id,
            kind="scenario_changed_titles",
            actor_user_id=recipient.id,
            payload={
                "title": "Сценарий изменён после начала титров",
                "summary": "Откройте актуальный сценарий",
                "target_href": f"/stories/{story_id}/scenario?production_context=titles",
                "diff": {"from_revision": 0, "to_revision": revision, "summary": {"total": 1}, "changes": []},
            },
        )
        newer = Notification(
            recipient_user_id=recipient.id,
            story_id=story_id,
            kind="scenario_changed_titles",
            actor_user_id=recipient.id,
            payload={
                "title": "Есть более новая редакция",
                "summary": "Не должна считаться открытой",
                "target_href": f"/stories/{story_id}/scenario?production_context=titles",
                "diff": {"from_revision": revision, "to_revision": revision + 1, "summary": {"total": 1}, "changes": []},
            },
        )
        db.add_all([matching, newer])
        db.commit()
        matching_id, newer_id = matching.id, newer.id

    response = client.get(f"/api/v1/integrations/captionpanels/stories/{story_id}/import-json")

    assert response.status_code == 200, response.text
    with SessionLocal() as db:
        assert db.get(Notification, matching_id).read_at is not None
        assert db.get(Notification, newer_id).read_at is None


def test_scenario_opened_upserts_per_user_context_and_validates_context_and_revision(client) -> None:
    story_id = _create_story()
    other_story_id = _create_story(username="caption-other", title="Другой синтетический сюжет")
    _login(client)
    revision, _session_id = _save_and_finish_session(
        client,
        story_id=story_id,
        base_revision=0,
        client_save_id="caption_opened_a",
        segment_uid="seg_00000000-0000-4000-8000-000000000342",
        text="Техническая редакция",
    )

    opened = client.post(
        f"/api/v1/stories/{story_id}/scenario/opened",
        json={"revision": revision, "context": "video"},
    )
    reopened_at_boundary = client.post(
        f"/api/v1/stories/{story_id}/scenario/opened",
        json={"revision": 0, "context": "video"},
    )
    invalid_context = client.post(
        f"/api/v1/stories/{story_id}/scenario/opened",
        json={"revision": revision, "context": "after_effects"},
    )
    missing_revision = client.post(
        f"/api/v1/stories/{story_id}/scenario/opened",
        json={"revision": revision + 100, "context": "titles"},
    )
    other_story_revision = client.post(
        f"/api/v1/stories/{other_story_id}/scenario/opened",
        json={"revision": revision, "context": "scenario"},
    )

    assert opened.status_code == 200, opened.text
    assert opened.json()["ok"] is True
    assert opened.json()["resource"]["type"] == "scenario"
    assert reopened_at_boundary.status_code == 200, reopened_at_boundary.text
    assert invalid_context.status_code == 422, invalid_context.text
    assert invalid_context.json()["error"]["code"] == "OPEN_CONTEXT_INVALID"
    assert missing_revision.status_code == 404, missing_revision.text
    assert missing_revision.json()["error"]["code"] == "REVISION_NOT_FOUND"
    assert other_story_revision.status_code == 404, other_story_revision.text
    assert other_story_revision.json()["error"]["code"] == "REVISION_NOT_FOUND"
    with SessionLocal() as db:
        marker = db.query(ScenarioReadMarker).filter_by(
            story_id=story_id,
            context="video",
        ).one()
        assert marker.revision_no == revision


def test_scenario_page_render_does_not_mark_captionpanels_opened(client) -> None:
    story_id = _create_story()
    _login(client)

    response = client.get(f"/api/v1/stories/{story_id}/scenario")

    assert response.status_code == 200, response.text
    assert response.json()["captionpanels"] == {
        "eligible": True,
        "last_opened_revision": None,
        "changed_since_last_open": False,
        "diff_session_id": None,
    }
    with SessionLocal() as db:
        assert db.query(ScenarioReadMarker).filter_by(
            story_id=story_id,
            context="captionpanels",
        ).one_or_none() is None
