from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select, update
from sqlalchemy.dialects import postgresql

from app.db.models import (
    ExternalApprovalCycle,
    Rubric,
    Scenario,
    ScenarioEditSession,
    ScenarioRow,
    Story,
    StoryAssignment,
    StoryEvent,
    StoryProductionState,
    StoryWorkflowState,
    User,
)
from app.db.session import SessionLocal, engine
from app.services.demo_seed import SYNTHETIC_DEMO_PASSWORD, seed_demo_data
from tests.sql_lock_order import (
    SqlTraceStatement,
    assert_aggregate_lock_order,
    capture_sql,
)


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


def _user(db, username: str) -> User:
    return db.query(User).filter(User.username == username).one()


def _active_rubric(db) -> Rubric:
    return db.query(Rubric).filter(Rubric.is_active.is_(True)).order_by(Rubric.id).first()


def _active_story(db, author: str = "lira") -> Story:
    user = _user(db, author)
    return (
        db.query(Story)
        .filter(Story.author_user_id == user.id, Story.archived_at.is_(None))
        .order_by(Story.id)
        .first()
    )


def _create(client, username: str = "lira", **overrides):
    with SessionLocal() as db:
        rubric_id = _active_rubric(db).id
    payload = {
        "title": "  Синтетический новый сюжет  ",
        "rubric_id": rubric_id,
        **overrides,
    }
    return client.post(
        "/api/v1/stories",
        json=payload,
        cookies=_login(client, username),
    )


def _approve_external(client, story_id: int) -> int:
    cookies = _login(client, "astra")
    sent = client.post(
        f"/api/v1/stories/{story_id}/external-approval/cycles/send",
        json={},
        cookies=cookies,
    )
    assert sent.status_code == 200, sent.text
    cycle_id = sent.json()["resource"]["id"]
    approved = client.post(
        f"/api/v1/stories/{story_id}/external-approval/cycles/{cycle_id}/approved",
        json={},
        cookies=cookies,
    )
    assert approved.status_code == 200, approved.text
    return cycle_id


def _mark_aired(client, story_id: int):
    return client.post(
        f"/api/v1/stories/{story_id}/production/mark-aired",
        json={},
        cookies=_login(client, "astra"),
    )


def _archive(client, story_id: int):
    return client.post(
        f"/api/v1/stories/{story_id}/archive",
        json={},
        cookies=_login(client, "astra"),
    )


@pytest.mark.parametrize(
    "relocked_table",
    [
        "stories",
        "scenarios",
        "story_workflow_states",
        "story_production_states",
    ],
)
def test_aggregate_lock_order_guard_rejects_every_base_relock_after_session(
    relocked_table: str,
) -> None:
    statements = [
        SqlTraceStatement.locked_table("stories"),
        SqlTraceStatement.locked_table("scenarios"),
        SqlTraceStatement.locked_table("story_workflow_states"),
        SqlTraceStatement.locked_table("story_production_states"),
        SqlTraceStatement.locked_table("scenario_edit_sessions"),
        SqlTraceStatement.locked_table(relocked_table),
    ]

    with pytest.raises(AssertionError):
        assert_aggregate_lock_order(statements)


def test_aggregate_lock_order_guard_ignores_ordinary_selects_after_session() -> None:
    statements = [
        SqlTraceStatement.locked_table("stories"),
        SqlTraceStatement.locked_table("scenarios"),
        SqlTraceStatement.locked_table("story_workflow_states"),
        SqlTraceStatement.locked_table("story_production_states"),
        SqlTraceStatement.locked_table("scenario_edit_sessions"),
        *[
            SqlTraceStatement(f"select * from {table}", False)
            for table in (
                "stories",
                "scenarios",
                "story_workflow_states",
                "story_production_states",
            )
        ],
    ]

    assert_aggregate_lock_order(statements)


@pytest.mark.parametrize(
    ("mixed_targets", "after_canonical_sequence"),
    [
        (("stories", "scenarios"), False),
        (("story_workflow_states", "story_production_states"), False),
        (("stories", "scenario_edit_sessions"), False),
        (("stories", "audit_events"), True),
    ],
)
def test_aggregate_lock_order_guard_rejects_mixed_tracked_lock(
    mixed_targets: tuple[str, ...],
    after_canonical_sequence: bool,
) -> None:
    canonical_sequence = [
        SqlTraceStatement.locked_table("stories"),
        SqlTraceStatement.locked_table("scenarios"),
        SqlTraceStatement.locked_table("story_workflow_states"),
        SqlTraceStatement.locked_table("story_production_states"),
        SqlTraceStatement.locked_table("scenario_edit_sessions"),
    ]
    mixed_statement = SqlTraceStatement(
        "select * from mixed_targets for update",
        True,
        mixed_targets,
    )
    statements = (
        [*canonical_sequence, mixed_statement]
        if after_canonical_sequence
        else [mixed_statement, *canonical_sequence]
    )

    with pytest.raises(AssertionError):
        assert_aggregate_lock_order(statements)


def test_aggregate_lock_order_guard_ignores_untracked_only_mixed_lock() -> None:
    statements = [
        SqlTraceStatement(
            "select * from audit_events join audit_details for update",
            True,
            ("audit_events", "audit_details"),
        ),
        SqlTraceStatement.locked_table("stories"),
        SqlTraceStatement.locked_table("scenarios"),
        SqlTraceStatement.locked_table("story_workflow_states"),
        SqlTraceStatement.locked_table("story_production_states"),
        SqlTraceStatement.locked_table("scenario_edit_sessions"),
    ]

    assert_aggregate_lock_order(statements)


def test_aggregate_lock_order_guard_rejects_collapsed_multi_table_lock() -> None:
    statements = [
        SqlTraceStatement(
            "select * from stories where "
            "exists (select 1 from scenarios) and "
            "exists (select 1 from story_workflow_states) and "
            "exists (select 1 from story_production_states) "
            "for update",
            True,
            ("stories",),
        ),
        SqlTraceStatement.locked_table("scenario_edit_sessions"),
    ]

    with pytest.raises(AssertionError):
        assert_aggregate_lock_order(statements)


@pytest.mark.parametrize(
    "missing_table",
    [
        "stories",
        "scenarios",
        "story_workflow_states",
        "story_production_states",
    ],
)
def test_aggregate_lock_order_guard_rejects_missing_base_lock(
    missing_table: str,
) -> None:
    statements = [
        SqlTraceStatement.locked_table(table)
        for table in (
            "stories",
            "scenarios",
            "story_workflow_states",
            "story_production_states",
        )
        if table != missing_table
    ]
    statements.append(
        SqlTraceStatement.locked_table("scenario_edit_sessions")
    )

    with pytest.raises(AssertionError):
        assert_aggregate_lock_order(statements)


@pytest.mark.parametrize("left_index", [0, 1, 2])
def test_aggregate_lock_order_guard_rejects_reordered_adjacent_pair(
    left_index: int,
) -> None:
    tables = [
        "stories",
        "scenarios",
        "story_workflow_states",
        "story_production_states",
    ]
    tables[left_index], tables[left_index + 1] = (
        tables[left_index + 1],
        tables[left_index],
    )
    statements = [
        SqlTraceStatement.locked_table(table)
        for table in tables
    ]
    statements.append(
        SqlTraceStatement.locked_table("scenario_edit_sessions")
    )

    with pytest.raises(AssertionError):
        assert_aggregate_lock_order(statements)


def test_aggregate_lock_order_guard_rejects_session_before_aggregate_complete() -> None:
    statements = [
        SqlTraceStatement.locked_table("stories"),
        SqlTraceStatement.locked_table("scenarios"),
        SqlTraceStatement.locked_table("scenario_edit_sessions"),
        SqlTraceStatement.locked_table("story_workflow_states"),
        SqlTraceStatement.locked_table("story_production_states"),
    ]

    with pytest.raises(AssertionError):
        assert_aggregate_lock_order(statements)


def test_create_options_are_server_derived_and_scope_eligible_active_authors(client) -> None:
    author_options = client.get(
        "/api/v1/stories/create-options",
        cookies=_login(client, "lira"),
    )
    chief_options = client.get(
        "/api/v1/stories/create-options",
        cookies=_login(client, "astra"),
    )

    assert author_options.status_code == 200, author_options.text
    assert [author["username"] for author in author_options.json()["authors"]] == ["lira"]
    assert author_options.json()["rubrics"]
    assert all(item["id"] > 0 for item in author_options.json()["rubrics"])
    assert author_options.json()["create_action"] == {
        "code": "story_create",
        "label": "Создать сюжет",
        "method": "POST",
        "href": "/api/v1/stories",
        "emphasis": "primary",
        "confirmation": None,
        "form": "story_create",
    }

    assert chief_options.status_code == 200, chief_options.text
    usernames = [author["username"] for author in chief_options.json()["authors"]]
    assert "lira" in usernames
    assert "mayak" in usernames
    assert "orion" not in usernames


def test_story_creation_permission_matrix_exact_payload_and_atomic_initial_state(client) -> None:
    with SessionLocal() as db:
        selected_author_id = _user(db, "mayak").id
        unrelated_id = _user(db, "lira").id
        before = {
            "stories": db.query(Story).count(),
            "scenarios": db.query(Scenario).count(),
            "workflow": db.query(StoryWorkflowState).count(),
            "production": db.query(StoryProductionState).count(),
            "events": db.query(StoryEvent).count(),
        }

    self_created = _create(client)
    chief_created = _create(
        client,
        "astra",
        title="Сюжет выбранного автора",
        author_user_id=selected_author_id,
    )
    forbidden = _create(
        client,
        "lira",
        title="Чужой автор",
        author_user_id=unrelated_id + 1,
    )

    assert self_created.status_code == 200, self_created.text
    assert chief_created.status_code == 200, chief_created.text
    assert forbidden.status_code == 403
    assert forbidden.json()["error"]["code"] == "FORBIDDEN"

    story_id = self_created.json()["resource"]["id"]
    assert self_created.json()["resource"] == {"type": "story", "id": story_id}
    with SessionLocal() as db:
        story = db.get(Story, story_id)
        assert story.title == "Синтетический новый сюжет"
        assert story.author_user_id == _user(db, "lira").id
        assert story.priority == "standard"
        assert story.aired_at is None
        assert story.archived_at is None
        assert db.query(StoryAssignment).filter_by(story_id=story_id).count() == 0
        scenario = db.query(Scenario).filter_by(story_id=story_id).one()
        assert scenario.revision_no == 0
        assert db.get(StoryWorkflowState, story_id) is not None
        assert db.get(StoryProductionState, story_id) is not None
        event = db.query(StoryEvent).filter_by(story_id=story_id).one()
        assert event.event_code == "story_created"
        assert event.revision_no == 0
        assert event.actor_user_id == story.author_user_id
        assert event.payload == {
            "title": "Синтетический новый сюжет",
            "rubric_id": story.rubric_id,
            "author_user_id": story.author_user_id,
        }
        assert db.query(Story).count() == before["stories"] + 2
        assert db.query(Scenario).count() == before["scenarios"] + 2
        assert db.query(StoryWorkflowState).count() == before["workflow"] + 2
        assert db.query(StoryProductionState).count() == before["production"] + 2
        assert db.query(StoryEvent).count() == before["events"] + 2

    active = client.get(
        "/api/v1/stories",
        params={"scope": "active", "search": "Синтетический новый сюжет"},
        cookies=_login(client, "orion"),
    )
    archived = client.get(
        "/api/v1/stories",
        params={"scope": "archive", "search": "Синтетический новый сюжет"},
        cookies=_login(client, "orion"),
    )
    scenario_read = client.get(
        f"/api/v1/stories/{story_id}/scenario",
        cookies=_login(client, "orion"),
    )
    assert active.json()["total"] == 1
    assert archived.json()["total"] == 0
    assert scenario_read.status_code == 200, scenario_read.text
    assert scenario_read.json()["scenario"] == {"revision": 0, "rows": []}
    assert scenario_read.json()["edit"]["state"] == "available"


def test_invalid_creation_leaves_no_partial_rows(client) -> None:
    with SessionLocal() as db:
        inactive_rubric = Rubric(name="Синтетическая закрытая рубрика", is_active=False)
        inactive_author = _user(db, "mayak")
        inactive_author.is_active = False
        db.add(inactive_rubric)
        db.commit()
        inactive_rubric_id = inactive_rubric.id
        inactive_author_id = inactive_author.id
        non_author_id = _user(db, "orion").id
        before = (
            db.query(Story).count(),
            db.query(Scenario).count(),
            db.query(StoryWorkflowState).count(),
            db.query(StoryProductionState).count(),
            db.query(StoryEvent).count(),
        )

    inactive_rubric_response = _create(
        client,
        "astra",
        title="Недоступная рубрика",
        rubric_id=inactive_rubric_id,
    )
    inactive_author_response = _create(
        client,
        "astra",
        title="Неактивный автор",
        author_user_id=inactive_author_id,
    )
    non_author_response = _create(
        client,
        "astra",
        title="Пользователь без функции автора",
        author_user_id=non_author_id,
    )
    blank_title = _create(client, title="   ")

    assert inactive_rubric_response.status_code == 409
    assert inactive_rubric_response.json()["error"]["code"] == "RUBRIC_INACTIVE"
    for response in (inactive_author_response, non_author_response):
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "AUTHOR_FUNCTION_REQUIRED"
    assert blank_title.status_code == 422
    with SessionLocal() as db:
        after = (
            db.query(Story).count(),
            db.query(Scenario).count(),
            db.query(StoryWorkflowState).count(),
            db.query(StoryProductionState).count(),
            db.query(StoryEvent).count(),
        )
        assert after == before


def test_mark_aired_is_leadership_only_requires_latest_completed_approval_and_rejects_repeat(client) -> None:
    with SessionLocal() as db:
        story_id = _active_story(db).id

    forbidden = client.post(
        f"/api/v1/stories/{story_id}/production/mark-aired",
        json={},
        cookies=_login(client, "lira"),
    )
    missing = _mark_aired(client, story_id)
    assert forbidden.status_code == 403
    assert forbidden.json()["error"]["code"] == "FORBIDDEN"
    assert missing.status_code == 409
    assert missing.json()["error"]["code"] == "EXTERNAL_APPROVAL_NOT_APPROVED"

    with SessionLocal() as db:
        chief = _user(db, "astra")
        db.add(
            ExternalApprovalCycle(
                story_id=story_id,
                cycle_no=1,
                sent_by_user_id=chief.id,
                result="changes_requested",
                decided_by_user_id=chief.id,
                decided_at=datetime.now(UTC),
            )
        )
        db.commit()
    rejected_latest = _mark_aired(client, story_id)
    assert rejected_latest.status_code == 409
    assert rejected_latest.json()["error"]["code"] == "EXTERNAL_APPROVAL_NOT_APPROVED"

    _approve_external(client, story_id)
    marked = _mark_aired(client, story_id)
    assert marked.status_code == 200, marked.text
    assert marked.json()["resource"] == {"type": "story", "id": story_id}
    with SessionLocal() as db:
        story = db.get(Story, story_id)
        assert story.aired_at is not None
        assert story.aired_by_user_id == _user(db, "astra").id
        event = db.query(StoryEvent).filter_by(story_id=story_id).order_by(StoryEvent.id.desc()).first()
        assert event.event_code == "story_aired"
    repeat = _mark_aired(client, story_id)
    assert repeat.status_code == 409
    assert repeat.json()["error"]["code"] == "STORY_ALREADY_AIRED"


def test_aired_story_remains_editable_until_archive(client) -> None:
    created = _create(client)
    story_id = created.json()["resource"]["id"]
    _approve_external(client, story_id)
    assert _mark_aired(client, story_id).status_code == 200

    metadata = client.patch(
        f"/api/v1/stories/{story_id}/metadata",
        json={"title": "Сюжет после эфира"},
        cookies=_login(client, "lira"),
    )
    lease = client.post(
        f"/api/v1/stories/{story_id}/scenario/lease",
        json={},
        cookies=_login(client, "lira"),
    )
    voiceover = client.post(
        f"/api/v1/stories/{story_id}/production/voiceover/ready",
        json={},
        cookies=_login(client, "orion"),
    )
    assert metadata.status_code == 200, metadata.text
    assert lease.status_code == 200, lease.text
    assert voiceover.status_code == 200, voiceover.text


def test_archive_finalizes_lease_moves_lists_and_makes_every_read_model_read_only(client) -> None:
    created = _create(client)
    story_id = created.json()["resource"]["id"]
    lira = _login(client, "lira")
    lease = client.post(
        f"/api/v1/stories/{story_id}/scenario/lease",
        json={},
        cookies=lira,
    )
    assert lease.status_code == 200, lease.text
    _approve_external(client, story_id)
    assert _mark_aired(client, story_id).status_code == 200

    not_leadership = client.post(
        f"/api/v1/stories/{story_id}/archive",
        json={},
        cookies=lira,
    )
    archived = _archive(client, story_id)
    assert not_leadership.status_code == 403
    assert archived.status_code == 200, archived.text
    assert archived.json()["resource"] == {"type": "story", "id": story_id}

    with SessionLocal() as db:
        story = db.get(Story, story_id)
        scenario = db.query(Scenario).filter_by(story_id=story_id).one()
        session = db.get(ScenarioEditSession, lease.json()["edit_session_id"])
        assert story.archived_at is not None
        assert story.archived_by_user_id == _user(db, "astra").id
        assert session.scenario_id == scenario.id
        assert session.ended_at is not None
        event = db.query(StoryEvent).filter_by(story_id=story_id).order_by(StoryEvent.id.desc()).first()
        assert event.event_code == "story_archived"

    active = client.get(
        "/api/v1/stories",
        params={"scope": "active", "search": "Синтетический новый сюжет"},
        cookies=_login(client, "sfera"),
    )
    archive = client.get(
        "/api/v1/stories",
        params={"scope": "archive", "search": "Синтетический новый сюжет"},
        cookies=_login(client, "sfera"),
    )
    assert active.json()["total"] == 0
    assert archive.json()["total"] == 1
    assert archive.json()["items"][0]["situation"] == {
        "code": "archive",
        "label": "В архиве",
    }

    for path in (
        f"/api/v1/stories/{story_id}",
        f"/api/v1/stories/{story_id}/scenario",
        f"/api/v1/stories/{story_id}/production",
        f"/api/v1/stories/{story_id}/workflow",
        f"/api/v1/stories/{story_id}/correction-packages",
        f"/api/v1/stories/{story_id}/external-approval/cycles",
        f"/api/v1/stories/{story_id}/history",
    ):
        response = client.get(path, cookies=_login(client, "sfera"))
        assert response.status_code == 200, f"{path}: {response.text}"
    scenario_read = client.get(
        f"/api/v1/stories/{story_id}/scenario",
        cookies=lira,
    )
    assert scenario_read.json()["edit"] == {
        "state": "archived",
        "edit_session_id": None,
        "holder": None,
        "expires_at": None,
    }
    assert scenario_read.json()["available_actions"] == []
    workflow = client.get(
        f"/api/v1/stories/{story_id}/workflow",
        cookies=_login(client, "astra"),
    ).json()
    external = client.get(
        f"/api/v1/stories/{story_id}/external-approval/cycles",
        cookies=_login(client, "astra"),
    ).json()
    production = client.get(
        f"/api/v1/stories/{story_id}/production",
        cookies=_login(client, "astra"),
    ).json()
    assert workflow["primary_action"] is None
    assert workflow["additional_actions"] == []
    assert external["send_action"] is None
    assert production["can_manage_assignments"] is False
    assert production["primary_action"]["code"] == "story_restore"
    assert production["primary_action"]["href"] == f"/api/v1/stories/{story_id}/restore"
    assert production["additional_actions"] == []


def test_archived_story_rejects_stale_lease_and_all_mutation_commands(client) -> None:
    created = _create(client)
    story_id = created.json()["resource"]["id"]
    lira = _login(client, "lira")
    lease = client.post(
        f"/api/v1/stories/{story_id}/scenario/lease",
        json={},
        cookies=lira,
    ).json()
    _approve_external(client, story_id)
    _mark_aired(client, story_id)
    _archive(client, story_id)
    lease_payload = {
        "edit_session_id": lease["edit_session_id"],
        "lease_token": lease["lease_token"],
    }

    writes = [
        client.patch(
            f"/api/v1/stories/{story_id}/metadata",
            json={"title": "Нельзя"},
            cookies=lira,
        ),
        client.post(
            f"/api/v1/stories/{story_id}/scenario/lease",
            json={},
            cookies=lira,
        ),
        client.post(
            f"/api/v1/stories/{story_id}/scenario/lease/heartbeat",
            json=lease_payload,
            cookies=lira,
        ),
        client.put(
            f"/api/v1/stories/{story_id}/scenario",
            json={
                "base_revision": 0,
                "client_save_id": uuid4().hex,
                **lease_payload,
                "rows": [],
            },
            cookies=lira,
        ),
        client.post(
            f"/api/v1/stories/{story_id}/scenario/opened",
            json={"revision": 0, "context": "scenario"},
            cookies=lira,
        ),
        client.post(
            f"/api/v1/stories/{story_id}/production/voiceover/ready",
            json={},
            cookies=lira,
        ),
        client.post(
            f"/api/v1/stories/{story_id}/external-approval/cycles/send",
            json={},
            cookies=_login(client, "astra"),
        ),
    ]
    assert [response.status_code for response in writes] == [409] * len(writes), [
        (response.status_code, response.text) for response in writes
    ]
    assert {response.json()["error"]["code"] for response in writes} == {"STORY_ARCHIVED"}


def test_archive_requires_aired_rejects_repeat_and_restore_preserves_current_history(client) -> None:
    created = _create(client)
    story_id = created.json()["resource"]["id"]
    not_aired = _archive(client, story_id)
    assert not_aired.status_code == 409
    assert not_aired.json()["error"]["code"] == "STORY_NOT_AIRED"

    _approve_external(client, story_id)
    _mark_aired(client, story_id)
    _archive(client, story_id)
    repeat_archive = _archive(client, story_id)
    assert repeat_archive.status_code == 409
    assert repeat_archive.json()["error"]["code"] == "STORY_ALREADY_ARCHIVED"

    with SessionLocal() as db:
        story_before = db.get(Story, story_id)
        scenario_before = db.query(Scenario).filter_by(story_id=story_id).one()
        event_count = db.query(StoryEvent).filter_by(story_id=story_id).count()
        aired_at = story_before.aired_at
        aired_by = story_before.aired_by_user_id
        revision = scenario_before.revision_no

    forbidden = client.post(
        f"/api/v1/stories/{story_id}/restore",
        json={},
        cookies=_login(client, "lira"),
    )
    restored = client.post(
        f"/api/v1/stories/{story_id}/restore",
        json={},
        cookies=_login(client, "astra"),
    )
    assert forbidden.status_code == 403
    assert restored.status_code == 200, restored.text
    with SessionLocal() as db:
        story_after = db.get(Story, story_id)
        scenario_after = db.query(Scenario).filter_by(story_id=story_id).one()
        assert story_after.archived_at is None
        assert story_after.archived_by_user_id is None
        assert story_after.aired_at == aired_at
        assert story_after.aired_by_user_id == aired_by
        assert scenario_after.revision_no == revision
        assert db.query(StoryEvent).filter_by(story_id=story_id).count() == event_count + 1
        assert (
            db.query(StoryEvent)
            .filter_by(story_id=story_id)
            .order_by(StoryEvent.id.desc())
            .first()
            .event_code
            == "story_restored"
        )

    lease_after_restore = client.post(
        f"/api/v1/stories/{story_id}/scenario/lease",
        json={},
        cookies=_login(client, "orion"),
    )
    assert lease_after_restore.status_code == 200, lease_after_restore.text
    repeated_restore = client.post(
        f"/api/v1/stories/{story_id}/restore",
        json={},
        cookies=_login(client, "astra"),
    )
    assert repeated_restore.status_code == 409
    assert repeated_restore.json()["error"]["code"] == "STORY_NOT_ARCHIVED"
    active = client.get(
        "/api/v1/stories",
        params={"scope": "active", "search": "Синтетический новый сюжет"},
        cookies=_login(client, "sfera"),
    )
    assert active.json()["total"] == 1


def test_archive_restore_and_history_restore_are_distinct_server_actions(client) -> None:
    created = _create(client)
    story_id = created.json()["resource"]["id"]
    _approve_external(client, story_id)
    _mark_aired(client, story_id)
    _archive(client, story_id)

    archived_story = client.get(
        f"/api/v1/stories/{story_id}",
        cookies=_login(client, "astra"),
    ).json()
    assert archived_story["lifecycle_actions"] == [
        {
            "code": "story_restore",
            "label": "Вернуть в работу",
            "method": "POST",
            "href": f"/api/v1/stories/{story_id}/restore",
            "emphasis": "primary",
            "confirmation": None,
            "form": None,
        }
    ]
    assert all("/history/edit-sessions/" not in action["href"] for action in archived_story["lifecycle_actions"])


def test_story_lists_publish_truthful_lifecycle_situations_and_stable_actions(client) -> None:
    created = _create(client)
    story_id = created.json()["resource"]["id"]
    cookies = _login(client, "astra")

    initial = client.get(f"/api/v1/stories/{story_id}", cookies=cookies).json()
    assert initial["situation"] == {"code": "active", "label": "В работе"}
    assert [action["code"] for action in initial["lifecycle_actions"]] == []

    sent = client.post(
        f"/api/v1/stories/{story_id}/external-approval/cycles/send",
        json={},
        cookies=cookies,
    )
    cycle_id = sent.json()["resource"]["id"]
    pending = client.get(f"/api/v1/stories/{story_id}", cookies=cookies).json()
    assert pending["situation"] == {
        "code": "external_pending",
        "label": "На внешнем согласовании",
    }

    client.post(
        f"/api/v1/stories/{story_id}/external-approval/cycles/{cycle_id}/approved",
        json={},
        cookies=cookies,
    )
    approved = client.get(f"/api/v1/stories/{story_id}", cookies=cookies).json()
    assert approved["situation"] == {
        "code": "ready_for_air",
        "label": "Согласовано · готово к эфиру",
    }
    assert approved["lifecycle_actions"][0]["href"] == (
        f"/api/v1/stories/{story_id}/production/mark-aired"
    )
    assert approved["lifecycle_actions"][0]["code"] == "story_mark_aired"

    _mark_aired(client, story_id)
    aired = client.get(f"/api/v1/stories/{story_id}", cookies=cookies).json()
    assert aired["situation"] == {"code": "aired", "label": "Вышел в эфир"}
    assert aired["lifecycle_actions"][0]["href"] == f"/api/v1/stories/{story_id}/archive"
    assert aired["lifecycle_actions"][0]["code"] == "story_archive"

    _archive(client, story_id)
    archived = client.get(f"/api/v1/stories/{story_id}", cookies=cookies).json()
    assert archived["situation"] == {"code": "archive", "label": "В архиве"}
    assert archived["lifecycle_actions"][0]["href"] == f"/api/v1/stories/{story_id}/restore"


def test_story_lock_statement_rechecks_lifecycle_under_postgresql_row_lock() -> None:
    from app.services.story_service import story_for_update_statement

    sql = str(story_for_update_statement(41).compile(dialect=postgresql.dialect()))

    assert "FOR UPDATE" in sql
    assert "stories.id =" in sql


def test_save_locks_aggregate_before_owned_session(client) -> None:
    created = _create(client)
    story_id = created.json()["resource"]["id"]
    cookies = _login(client, "lira")
    lease = client.post(
        f"/api/v1/stories/{story_id}/scenario/lease",
        json={},
        cookies=cookies,
    ).json()
    segment_uid = f"seg_{uuid4()}"

    def save() -> None:
        response = client.put(
            f"/api/v1/stories/{story_id}/scenario",
            json={
                "base_revision": 0,
                "client_save_id": uuid4().hex,
                "edit_session_id": lease["edit_session_id"],
                "lease_token": lease["lease_token"],
                "rows": [
                    {
                        "segment_uid": segment_uid,
                        "order_index": 1,
                        "block_type": "zk",
                        "text": "Проверка порядка блокировок сохранения",
                    }
                ],
            },
            cookies=cookies,
        )
        assert response.status_code == 200, response.text

    assert_aggregate_lock_order(capture_sql(engine, save))


def test_workflow_command_locks_aggregate_before_session_finalization(client) -> None:
    created = _create(client)
    story_id = created.json()["resource"]["id"]
    cookies = _login(client, "lira")
    lease = client.post(
        f"/api/v1/stories/{story_id}/scenario/lease",
        json={},
        cookies=cookies,
    )
    assert lease.status_code == 200, lease.text

    def submit_review() -> None:
        response = client.post(
            f"/api/v1/stories/{story_id}/workflow/submit-review",
            json={"revision": 0},
            cookies=cookies,
        )
        assert response.status_code == 200, response.text

    assert_aggregate_lock_order(capture_sql(engine, submit_review))


def test_active_scenario_get_locks_aggregate_before_expired_session(client) -> None:
    created = _create(client)
    story_id = created.json()["resource"]["id"]
    cookies = _login(client, "lira")
    lease = client.post(
        f"/api/v1/stories/{story_id}/scenario/lease",
        json={},
        cookies=cookies,
    )
    assert lease.status_code == 200, lease.text
    with SessionLocal() as db:
        session = db.get(ScenarioEditSession, lease.json()["edit_session_id"])
        assert session is not None
        session.expires_at = datetime.now(UTC) - timedelta(minutes=1)
        db.commit()

    def read_scenario() -> None:
        response = client.get(
            f"/api/v1/stories/{story_id}/scenario",
            cookies=cookies,
        )
        assert response.status_code == 200, response.text
        assert response.json()["edit"]["state"] == "available"

    assert_aggregate_lock_order(capture_sql(engine, read_scenario))


def test_active_scenario_get_returns_one_refreshed_revision_and_rows_snapshot(
    client,
    monkeypatch,
) -> None:
    created = _create(client)
    story_id = created.json()["resource"]["id"]
    segment_uid = f"seg_{uuid4()}"
    from app.api.routes import scenario as scenario_routes

    real_lock = scenario_routes.lock_story_aggregate
    injected = False

    def inject_revision_before_aggregate_lock(db, *, story_id: int):
        nonlocal injected
        if not injected:
            injected = True
            scenario_id = db.scalar(
                select(Scenario.id).where(Scenario.story_id == story_id)
            )
            assert scenario_id is not None
            db.execute(
                update(Scenario)
                .where(Scenario.id == scenario_id)
                .values(revision_no=1)
                .execution_options(synchronize_session=False)
            )
            db.add(
                ScenarioRow(
                    scenario_id=scenario_id,
                    segment_uid=segment_uid,
                    order_index=1,
                    block_type="zk",
                    text="Строка конкурентной редакции",
                )
            )
            db.flush()
        return real_lock(db, story_id=story_id)

    monkeypatch.setattr(
        scenario_routes,
        "lock_story_aggregate",
        inject_revision_before_aggregate_lock,
    )

    response = client.get(
        f"/api/v1/stories/{story_id}/scenario",
        cookies=_login(client, "lira"),
    )

    assert response.status_code == 200, response.text
    assert response.json()["scenario"] == {
        "revision": 1,
        "rows": [
            {
                "segment_uid": segment_uid,
                "order_index": 1,
                "block_type": "zk",
                "text": "Строка конкурентной редакции",
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
    }
