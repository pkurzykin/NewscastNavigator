from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from time import monotonic, sleep

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text

from app.core.security import hash_password
from app.db.models import (
    CorrectionPackage, CorrectionPart, ExternalApprovalCycle, Notification, Rubric,
    Scenario, ScenarioEditSession, ScenarioReadMarker, ScenarioRevision,
    ScenarioRevisionRow, ScenarioRow, Story, StoryAssignment, StoryEvent,
    StoryMaterialLink, StoryProductionState, StoryWorkflowState, User, UserFunction,
)
from app.db.session import SessionLocal, engine


PASSWORD = "Synthetic-delete-test-42"


def _actor(functions: tuple[str, ...]) -> int:
    with SessionLocal() as db:
        actor = User(
            username="archive-test", display_name="Синтетический сотрудник",
            position="Тест", password_hash=hash_password(PASSWORD),
            is_active=True, must_change_password=False,
            functions=[UserFunction(function_code=code) for code in functions],
        )
        db.add(actor)
        db.commit()
        return actor.id


def _cookies(client):
    response = client.post("/api/v1/auth/login", json={
        "username": "archive-test", "password": PASSWORD,
    })
    assert response.status_code == 200, response.text
    return dict(response.cookies)


def _story(actor_id: int, *, archived: bool = True) -> int:
    with SessionLocal() as db:
        rubric = db.scalar(select(Rubric).limit(1))
        if rubric is None:
            rubric = Rubric(name="Синтетическая рубрика", is_active=True)
            db.add(rubric)
            db.flush()
        now = datetime.now(UTC)
        story = Story(
            title="Синтетическая архивная карточка", rubric_id=rubric.id,
            author_user_id=actor_id, aired_at=now if archived else None,
            archived_at=now if archived else None,
        )
        db.add(story)
        db.flush()
        db.add_all([Scenario(story_id=story.id), StoryWorkflowState(story_id=story.id),
                    StoryProductionState(story_id=story.id)])
        db.commit()
        return story.id


@pytest.mark.parametrize("functions,allowed", [
    (("author",), True), (("proofreader",), True), (("operator",), True),
    (("chief",), True), (("chief_editor",), True),
    (("video_editor",), False), (("designer",), False),
    (("chief", "video_editor"), False), (("chief_editor", "designer"), False),
    (("author", "designer", "proofreader"), False),
])
def test_archived_delete_permissions_and_independent_read_model(client, functions, allowed):
    actor_id = _actor(functions)
    story_id = _story(actor_id)
    cookies = _cookies(client)
    listing = client.get("/api/v1/stories?scope=archive", cookies=cookies)
    assert listing.status_code == 200, listing.text
    item = listing.json()["items"][0]
    action = item.get("delete_action")
    assert bool(action) is allowed
    if allowed:
        assert action["method"] == "DELETE"
        assert action["href"] == f"/api/v1/stories/{story_id}"
        assert action["emphasis"] == "danger"
    restore = any(a["code"] == "story_restore" for a in item["lifecycle_actions"])
    assert restore is bool(set(functions) & {"chief", "chief_editor"})
    response = client.delete(f"/api/v1/stories/{story_id}", cookies=cookies)
    assert response.status_code == (200 if allowed else 403), response.text
    with SessionLocal() as db:
        assert (db.get(Story, story_id) is None) is allowed


def test_active_story_cannot_be_deleted_and_disabled_user_cannot_delete(client):
    actor_id = _actor(("chief",))
    story_id = _story(actor_id, archived=False)
    archived_id = _story(actor_id)
    cookies = _cookies(client)
    item = client.get(f"/api/v1/stories/{story_id}", cookies=cookies).json()
    assert item.get("delete_action") is None
    response = client.delete(f"/api/v1/stories/{story_id}", cookies=cookies)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "STORY_NOT_ARCHIVED"
    with SessionLocal() as db:
        db.get(User, actor_id).is_active = False
        db.commit()
    assert client.delete(f"/api/v1/stories/{archived_id}", cookies=cookies).status_code == 401
    with SessionLocal() as db:
        assert db.get(Story, story_id) is not None
        assert db.get(Story, archived_id) is not None


def test_delete_cascades_owned_graph_and_preserves_shared_records_and_external_file(client, tmp_path):
    actor_id = _actor(("author",))
    story_id = _story(actor_id)
    other_id = _story(actor_id)
    external = tmp_path / "synthetic-material.txt"
    external.write_text("Общий исходник", encoding="utf-8")
    with SessionLocal() as db:
        scenario = db.scalar(select(Scenario).where(Scenario.story_id == story_id))
        scenario_id = scenario.id
        rubric_id = db.get(Story, story_id).rubric_id
        session = ScenarioEditSession(
            scenario_id=scenario_id, actor_user_id=actor_id,
            lease_token_hash=uuid4().hex, base_revision_no=0, latest_revision_no=1,
            expires_at=datetime.now(UTC) + timedelta(minutes=1), ended_at=datetime.now(UTC),
        )
        package = CorrectionPackage(story_id=story_id, source="external", created_by_user_id=actor_id)
        db.add_all([session, package])
        db.flush()
        revision = ScenarioRevision(
            scenario_id=scenario_id, revision_no=1, client_save_id=uuid4().hex,
            edit_session_id=session.id, created_by_user_id=actor_id,
        )
        db.add(revision)
        db.flush()
        db.add_all([
            ScenarioRow(scenario_id=scenario_id, segment_uid="seg_current", order_index=1, block_type="zk"),
            ScenarioRevisionRow(revision_id=revision.id, segment_uid="seg_current", order_index=1, block_type="zk"),
            ScenarioReadMarker(story_id=story_id, user_id=actor_id, context="captionpanels", revision_no=1),
            StoryAssignment(story_id=story_id, kind="proofreader", user_id=actor_id, assigned_by_user_id=actor_id),
            StoryMaterialLink(story_id=story_id, title="Исходник", location=str(external), added_by_user_id=actor_id),
            StoryEvent(story_id=story_id, event_code="synthetic_event", actor_user_id=actor_id),
            Notification(story_id=story_id, recipient_user_id=actor_id, kind="scenario_changed", edit_session_id=session.id),
            CorrectionPart(package_id=package.id, scope="text", description="Тест", assignee_user_id=actor_id),
            ExternalApprovalCycle(story_id=story_id, cycle_no=1, sent_by_user_id=actor_id,
                                  result="changes_requested", correction_package_id=package.id),
        ])
        db.commit()
    cookies = _cookies(client)
    response = client.delete(f"/api/v1/stories/{story_id}", cookies=cookies)
    assert response.status_code == 200, response.text
    assert response.json()["resource"] == {"type": "story", "id": story_id}
    assert response.json()["event_id"] is None
    with SessionLocal() as db:
        assert db.get(Story, story_id) is None
        assert db.get(Scenario, scenario_id) is None
        for model in (ScenarioRow, ScenarioEditSession, ScenarioRevision, ScenarioRevisionRow,
                      ScenarioReadMarker, StoryAssignment, StoryMaterialLink, StoryEvent,
                      Notification, CorrectionPackage, CorrectionPart, ExternalApprovalCycle):
            assert db.scalar(select(model).limit(1)) is None, model.__tablename__
        assert db.get(StoryWorkflowState, story_id) is None
        assert db.get(StoryProductionState, story_id) is None
        assert db.get(Story, other_id) is not None
        assert db.get(User, actor_id) is not None
        assert db.get(Rubric, rubric_id) is not None
    assert external.read_text(encoding="utf-8") == "Общий исходник"
    assert client.get(f"/api/v1/stories/{story_id}", cookies=cookies).status_code == 404
    assert client.get(f"/api/v1/stories/{story_id}/scenario", cookies=cookies).status_code == 404
    assert client.get(f"/api/v1/integrations/captionpanels/stories/{story_id}/import-json", cookies=cookies).status_code == 404
    assert client.delete(f"/api/v1/stories/{story_id}", cookies=cookies).status_code == 404


def test_failed_delete_transaction_preserves_entire_aggregate(client, monkeypatch):
    from app.services.story_service import delete_archived_story

    actor_id = _actor(("chief",))
    story_id = _story(actor_id)
    with SessionLocal() as db:
        actor = db.get(User, actor_id)
        def failed_commit():
            db.flush()
            raise RuntimeError("Synthetic commit failure")
        monkeypatch.setattr(db, "commit", failed_commit)
        with pytest.raises(RuntimeError, match="Synthetic commit failure"):
            delete_archived_story(db, story_id=story_id, actor=actor)
        db.rollback()
    with SessionLocal() as db:
        assert db.get(Story, story_id) is not None
        assert db.scalar(select(Scenario).where(Scenario.story_id == story_id)) is not None
        assert db.get(StoryWorkflowState, story_id) is not None
        assert db.get(StoryProductionState, story_id) is not None


def test_delete_rechecks_functions_after_waiting_for_aggregate(client, monkeypatch):
    from app.services import story_service

    actor_id = _actor(("chief",))
    story_id = _story(actor_id)
    original_lock = story_service.lock_story_aggregate
    def lock_after_role_change(db, *, story_id):
        # Simulate a role change since authentication populated the actor object.
        db.execute(UserFunction.__table__.insert().values(user_id=actor_id, function_code="designer"))
        return original_lock(db, story_id=story_id)
    monkeypatch.setattr(story_service, "lock_story_aggregate", lock_after_role_change)
    with SessionLocal() as db:
        actor = db.get(User, actor_id)
        assert actor.function_codes == ["chief"]
        with pytest.raises(HTTPException) as error:
            story_service.delete_archived_story(db, story_id=story_id, actor=actor)
        assert error.value.status_code == 403
        assert db.get(Story, story_id) is not None
        db.rollback()


@pytest.mark.skipif(engine.dialect.name != "postgresql", reason="Requires real PostgreSQL row locks")
@pytest.mark.parametrize("first_command", ["delete", "restore"])
def test_delete_restore_race_rechecks_lifecycle_after_lock(client, first_command):
    from app.services.story_service import delete_archived_story, restore_story

    actor_id = _actor(("chief",))
    story_id = _story(actor_id)
    commands = {"delete": delete_archived_story, "restore": restore_story}
    second_command = "restore" if first_command == "delete" else "delete"
    first_ready, release_first, second_ready = Event(), Event(), Event()
    second_pid = []

    def run(command, *, hold_commit=False):
        with SessionLocal() as db:
            actor = db.get(User, actor_id)
            if hold_commit:
                commit = db.commit
                def gated_commit():
                    db.flush()
                    first_ready.set()
                    assert release_first.wait(10), "Race harness did not release first transaction"
                    commit()
                db.commit = gated_commit
            else:
                second_pid.append(db.scalar(text("SELECT pg_backend_pid()")))
                second_ready.set()
            try:
                commands[command](db, story_id=story_id, actor=actor)
                return 200
            except HTTPException as error:
                db.rollback()
                return error.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(run, first_command, hold_commit=True)
        try:
            assert first_ready.wait(5)
            second = pool.submit(run, second_command)
            assert second_ready.wait(5)
            deadline = monotonic() + 5
            blocked = False
            with engine.connect() as observer:
                while monotonic() < deadline:
                    blocked = bool(observer.scalar(text("SELECT cardinality(pg_blocking_pids(:pid))"),
                                                   {"pid": second_pid[0]}))
                    if blocked:
                        break
                    sleep(0.02)
            assert blocked, "The second command must actually wait on PostgreSQL, not run sequentially"
        finally:
            release_first.set()
        assert first.result(timeout=5) == 200
        assert second.result(timeout=5) == (404 if first_command == "delete" else 409)
    with SessionLocal() as db:
        story = db.get(Story, story_id)
        if first_command == "delete":
            assert story is None
        else:
            assert story is not None and story.archived_at is None
