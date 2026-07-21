from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.db.models import (
    CorrectionPackage,
    CorrectionPart,
    Scenario,
    Story,
    StoryAssignment,
    StoryEvent,
    StoryMaterialLink,
    StoryProductionState,
    StoryWorkflowState,
    User,
    UserFunction,
)
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


def _user_id(username: str) -> int:
    with SessionLocal() as db:
        return db.query(User.id).filter(User.username == username).scalar()


def _story_for_author(username: str = "lira") -> int:
    with SessionLocal() as db:
        author_id = db.query(User.id).filter(User.username == username).scalar()
        row = (
            db.query(Story.id)
            .filter(Story.author_user_id == author_id, Story.archived_at.is_(None))
            .order_by(Story.id)
            .first()
        )
        story_id = row[0] if row is not None else None
        assert story_id is not None
        return story_id


def _revision(story_id: int) -> int:
    with SessionLocal() as db:
        return db.query(Scenario.revision_no).filter(Scenario.story_id == story_id).scalar()


def _assign(story_id: int, kind: str, username: str) -> None:
    with SessionLocal() as db:
        db.add(
            StoryAssignment(
                story_id=story_id,
                kind=kind,
                user_id=db.query(User.id).filter(User.username == username).scalar(),
                assigned_by_user_id=db.query(User.id).filter(User.username == "astra").scalar(),
            )
        )
        db.commit()


def _post(client, story_id: int, path: str, username: str, body: dict | None = None):
    return client.post(
        f"/api/v1/stories/{story_id}/{path}",
        json={} if body is None else body,
        cookies=_login(client, username),
    )


def _code(response) -> str:
    return response.json()["error"]["code"]


def _snapshot(story_id: int) -> tuple[dict, dict, int, int, int]:
    with SessionLocal() as db:
        production = db.get(StoryProductionState, story_id)
        workflow = db.get(StoryWorkflowState, story_id)
        assert production is not None and workflow is not None
        return (
            {column.name: getattr(production, column.name) for column in StoryProductionState.__table__.columns},
            {column.name: getattr(workflow, column.name) for column in StoryWorkflowState.__table__.columns},
            db.query(CorrectionPackage).filter(CorrectionPackage.story_id == story_id).count(),
            db.query(CorrectionPart).join(CorrectionPackage).filter(CorrectionPackage.story_id == story_id).count(),
            db.query(StoryEvent).filter(StoryEvent.story_id == story_id).count(),
        )


def test_assignment_upsert_delete_permission_validation_and_exact_errors(client) -> None:
    story_id = _story_for_author()
    mayak = _user_id("mayak")
    orion = _user_id("orion")
    runa = _user_id("runa")
    lira = _user_id("lira")
    with SessionLocal() as db:
        db.add(UserFunction(user_id=lira, function_code="video_editor"))
        db.commit()

    forbidden = client.put(
        f"/api/v1/stories/{story_id}/assignments/proofreader",
        json={"user_id": mayak}, cookies=_login(client, "lira"),
    )
    invalid_kind = client.put(
        f"/api/v1/stories/{story_id}/assignments/author",
        json={"user_id": mayak}, cookies=_login(client, "astra"),
    )
    mismatch = client.put(
        f"/api/v1/stories/{story_id}/assignments/video_editor",
        json={"user_id": runa}, cookies=_login(client, "astra"),
    )
    with SessionLocal() as db:
        db.get(User, mayak).is_active = False
        db.commit()
    inactive = client.put(
        f"/api/v1/stories/{story_id}/assignments/proofreader",
        json={"user_id": mayak}, cookies=_login(client, "astra"),
    )
    assigned = client.put(
        f"/api/v1/stories/{story_id}/assignments/video_editor",
        json={"user_id": orion}, cookies=_login(client, "astra"),
    )
    reassigned = client.put(
        f"/api/v1/stories/{story_id}/assignments/video_editor",
        json={"user_id": lira}, cookies=_login(client, "astra"),
    )

    assert forbidden.status_code == 403 and _code(forbidden) == "FORBIDDEN"
    assert invalid_kind.status_code == 422 and _code(invalid_kind) == "ASSIGNMENT_KIND_INVALID"
    assert mismatch.status_code == 422 and _code(mismatch) == "ASSIGNEE_FUNCTION_MISMATCH"
    assert inactive.status_code == 409 and _code(inactive) == "USER_INACTIVE"
    assert assigned.status_code == 200 and reassigned.status_code == 200
    with SessionLocal() as db:
        rows = db.query(StoryAssignment).filter(StoryAssignment.story_id == story_id).all()
        assert len(rows) == 1
        assert rows[0].kind == "video_editor"
        assert rows[0].user_id == lira
        assert db.query(StoryEvent).filter(StoryEvent.story_id == story_id).count() == 2

    deleted = client.delete(
        f"/api/v1/stories/{story_id}/assignments/video_editor",
        cookies=_login(client, "iskra"),
    )
    missing = client.delete(
        f"/api/v1/stories/{story_id}/assignments/video_editor",
        cookies=_login(client, "iskra"),
    )
    invalid_delete = client.delete(
        f"/api/v1/stories/{story_id}/assignments/operator",
        cookies=_login(client, "iskra"),
    )
    assert deleted.status_code == 200
    assert missing.status_code == 404 and _code(missing) == "ASSIGNMENT_NOT_FOUND"
    assert invalid_delete.status_code == 422 and _code(invalid_delete) == "ASSIGNMENT_KIND_INVALID"


def test_regular_active_user_adds_trimmed_material_and_invalid_or_archived_is_rejected(client) -> None:
    story_id = _story_for_author()
    added = _post(
        client, story_id, "materials", "sfera",
        {"title": "  Карта проезда  ", "location": "  smb://news/materials/map.mov  "},
    )
    invalid = _post(client, story_id, "materials", "sfera", {"title": "Источник", "location": "   "})
    with SessionLocal() as db:
        archived_id = db.query(Story.id).filter(Story.archived_at.is_not(None)).order_by(Story.id).first()[0]
    archived = _post(client, archived_id, "materials", "sfera", {"title": "Источник", "location": "/tmp/source"})

    assert added.status_code == 200, added.text
    assert added.json()["resource"]["type"] == "story_material"
    assert invalid.status_code == 422 and _code(invalid) == "MATERIAL_LOCATION_INVALID"
    assert archived.status_code == 409 and _code(archived) == "STORY_ARCHIVED"
    with SessionLocal() as db:
        material = db.get(StoryMaterialLink, added.json()["resource"]["id"])
        assert material.title == "Карта проезда"
        assert material.location == "smb://news/materials/map.mov"


def test_voiceover_ready_is_available_to_any_active_user_and_not_ready_is_atomic_leadership_command(client) -> None:
    story_id = _story_for_author()
    ready = _post(client, story_id, "production/voiceover/ready", "sfera")
    duplicate = _post(client, story_id, "production/voiceover/ready", "lira")
    forbidden = _post(
        client, story_id, "production/voiceover/not-ready", "lira",
        {"description": "Перезаписать финальную фразу", "assignee_user_id": _user_id("orion")},
    )
    bad_assignee = _post(
        client, story_id, "production/voiceover/not-ready", "astra",
        {"description": "Перезаписать", "assignee_user_id": 999999},
    )
    returned = _post(
        client, story_id, "production/voiceover/not-ready", "astra",
        {"description": "  Перезаписать финальную фразу  ", "assignee_user_id": _user_id("orion")},
    )
    already_not_ready = _post(
        client, story_id, "production/voiceover/not-ready", "astra",
        {"description": "Повтор", "assignee_user_id": _user_id("orion")},
    )

    assert ready.status_code == 200
    assert duplicate.status_code == 409 and _code(duplicate) == "VOICEOVER_ALREADY_READY"
    assert forbidden.status_code == 403 and _code(forbidden) == "FORBIDDEN"
    assert bad_assignee.status_code == 422 and _code(bad_assignee) == "ASSIGNEE_INVALID"
    assert returned.status_code == 200, returned.text
    assert already_not_ready.status_code == 409 and _code(already_not_ready) == "VOICEOVER_ALREADY_NOT_READY"
    with SessionLocal() as db:
        production = db.get(StoryProductionState, story_id)
        package = db.query(CorrectionPackage).filter(CorrectionPackage.story_id == story_id).one()
        part = db.query(CorrectionPart).filter(CorrectionPart.package_id == package.id).one()
        assert production.voiceover_ready is False
        assert production.voiceover_ready_by_user_id is None
        assert production.voiceover_ready_at is None
        assert package.source == "internal" and package.closed_at is None
        assert part.scope == "voiceover" and part.state == "pending"
        assert part.description == "Перезаписать финальную фразу"
        assert part.assignee_user_id == _user_id("orion")
        assert db.query(StoryEvent).filter(StoryEvent.story_id == story_id).count() == 2


def test_video_start_before_text_gates_checks_revision_assignment_leadership_and_duplicate(client) -> None:
    story_id = _story_for_author()
    _assign(story_id, "video_editor", "orion")
    revision = _revision(story_id)
    forbidden = _post(client, story_id, "production/video/start", "sfera", {"revision": revision})
    stale = _post(client, story_id, "production/video/start", "orion", {"revision": revision + 1})
    started = _post(client, story_id, "production/video/start", "orion", {"revision": revision})
    duplicate = _post(client, story_id, "production/video/start", "astra", {"revision": revision})

    assert forbidden.status_code == 403 and _code(forbidden) == "FORBIDDEN"
    assert stale.status_code == 409 and _code(stale) == "REVISION_NOT_CURRENT"
    assert started.status_code == 200, started.text
    assert duplicate.status_code == 409 and _code(duplicate) == "VIDEO_ALREADY_STARTED"
    with SessionLocal() as db:
        state = db.get(StoryProductionState, story_id)
        workflow = db.get(StoryWorkflowState, story_id)
        assert state.video_started_revision == revision
        assert state.video_started_by_user_id == _user_id("orion")
        assert workflow.editorial_revision is None and workflow.proofread_revision is None


def test_video_ready_transition_duplicate_and_open_correction_gate(client) -> None:
    story_id = _story_for_author()
    _assign(story_id, "video_editor", "orion")
    not_started = _post(client, story_id, "production/video/ready", "orion")
    assert not_started.status_code == 409 and _code(not_started) == "VIDEO_NOT_STARTED"
    assert _post(client, story_id, "production/video/start", "orion", {"revision": 0}).status_code == 200
    with SessionLocal() as db:
        package = CorrectionPackage(story_id=story_id, source="internal", created_by_user_id=_user_id("astra"))
        db.add(package)
        db.flush()
        db.add(CorrectionPart(package_id=package.id, scope="video", description="Исправить склейку", assignee_user_id=_user_id("orion"), state="pending"))
        db.commit()
    blocked = _post(client, story_id, "production/video/ready", "orion")
    assert blocked.status_code == 409 and _code(blocked) == "OPEN_VIDEO_CORRECTION_EXISTS"
    with SessionLocal() as db:
        package = db.query(CorrectionPackage).filter(CorrectionPackage.story_id == story_id).one()
        package.closed_by_user_id = _user_id("astra")
        package.closed_at = datetime.now(UTC)
        db.commit()
    ready = _post(client, story_id, "production/video/ready", "astra")
    duplicate = _post(client, story_id, "production/video/ready", "orion")
    assert ready.status_code == 200
    assert duplicate.status_code == 409 and _code(duplicate) == "VIDEO_ALREADY_READY"


def test_video_approval_requires_each_text_gate_but_marks_survive_late_revision(client) -> None:
    story_id = _story_for_author()
    with SessionLocal() as db:
        state = db.get(StoryProductionState, story_id)
        state.video_started_revision = 0
        state.video_started_by_user_id = _user_id("orion")
        state.video_started_at = datetime.now(UTC)
        state.video_ready_by_user_id = _user_id("orion")
        state.video_ready_at = datetime.now(UTC)
        db.commit()
    no_editorial = _post(client, story_id, "production/video/approve-for-titles", "astra")
    assert no_editorial.status_code == 409 and _code(no_editorial) == "EDITORIAL_GATE_NOT_MET"
    with SessionLocal() as db:
        workflow = db.get(StoryWorkflowState, story_id)
        workflow.editorial_revision = 0
        workflow.editorial_by_user_id = _user_id("astra")
        workflow.editorial_at = datetime.now(UTC)
        db.commit()
    no_proofread = _post(client, story_id, "production/video/approve-for-titles", "astra")
    assert no_proofread.status_code == 409 and _code(no_proofread) == "PROOFREAD_GATE_NOT_MET"
    with SessionLocal() as db:
        workflow = db.get(StoryWorkflowState, story_id)
        workflow.proofread_revision = 0
        workflow.proofread_by_user_id = _user_id("mayak")
        workflow.proofread_at = datetime.now(UTC)
        scenario = db.query(Scenario).filter(Scenario.story_id == story_id).one()
        scenario.revision_no = 4
        workflow.changed_after_proofread = True
        db.commit()
    forbidden = _post(client, story_id, "production/video/approve-for-titles", "orion")
    approved = _post(client, story_id, "production/video/approve-for-titles", "iskra")
    duplicate = _post(client, story_id, "production/video/approve-for-titles", "astra")
    assert forbidden.status_code == 403 and _code(forbidden) == "FORBIDDEN"
    assert approved.status_code == 200, approved.text
    assert duplicate.status_code == 409 and _code(duplicate) == "INVALID_TRANSITION"


def test_titles_start_permission_revision_initial_gate_duplicate_and_late_edit(client) -> None:
    story_id = _story_for_author()
    _assign(story_id, "designer", "runa")
    with SessionLocal() as db:
        workflow = db.get(StoryWorkflowState, story_id)
        production = db.get(StoryProductionState, story_id)
        workflow.editorial_revision = 0
        workflow.editorial_by_user_id = _user_id("astra")
        workflow.editorial_at = datetime.now(UTC)
        workflow.proofread_revision = 0
        workflow.proofread_by_user_id = _user_id("mayak")
        workflow.proofread_at = datetime.now(UTC)
        production.video_started_revision = 0
        production.video_started_by_user_id = _user_id("orion")
        production.video_started_at = datetime.now(UTC)
        production.video_ready_by_user_id = _user_id("orion")
        production.video_ready_at = datetime.now(UTC)
        db.commit()
    blocked = _post(client, story_id, "production/titles/start", "runa", {"revision": 0})
    assert blocked.status_code == 409 and _code(blocked) == "TITLES_INITIAL_GATE_NOT_MET"
    assert _post(client, story_id, "production/video/approve-for-titles", "astra").status_code == 200
    forbidden = _post(client, story_id, "production/titles/start", "orion", {"revision": 0})
    stale = _post(client, story_id, "production/titles/start", "runa", {"revision": 1})
    started = _post(client, story_id, "production/titles/start", "runa", {"revision": 0})
    duplicate = _post(client, story_id, "production/titles/start", "astra", {"revision": 0})
    assert forbidden.status_code == 403 and _code(forbidden) == "FORBIDDEN"
    assert stale.status_code == 409 and _code(stale) == "REVISION_NOT_CURRENT"
    assert started.status_code == 200
    assert duplicate.status_code == 409 and _code(duplicate) == "TITLES_ALREADY_STARTED"
    with SessionLocal() as db:
        db.query(Scenario).filter(Scenario.story_id == story_id).one().revision_no = 3
        db.commit()
    assert _post(client, story_id, "production/titles/ready", "runa").status_code == 200


def test_titles_ready_accept_permissions_duplicates_and_correction_gate(client) -> None:
    story_id = _story_for_author()
    _assign(story_id, "designer", "runa")
    not_started = _post(client, story_id, "production/titles/ready", "runa")
    assert not_started.status_code == 409 and _code(not_started) == "TITLES_NOT_STARTED"
    with SessionLocal() as db:
        state = db.get(StoryProductionState, story_id)
        state.titles_started_revision = 0
        state.titles_started_by_user_id = _user_id("runa")
        state.titles_started_at = datetime.now(UTC)
        package = CorrectionPackage(story_id=story_id, source="internal", created_by_user_id=_user_id("astra"))
        db.add(package)
        db.flush()
        db.add(CorrectionPart(package_id=package.id, scope="titles", description="Исправить плашку", assignee_user_id=_user_id("runa"), state="done"))
        db.commit()
    blocked = _post(client, story_id, "production/titles/ready", "runa")
    assert blocked.status_code == 409 and _code(blocked) == "OPEN_TITLES_CORRECTION_EXISTS"
    with SessionLocal() as db:
        package = db.query(CorrectionPackage).filter(CorrectionPackage.story_id == story_id).one()
        package.closed_by_user_id = _user_id("astra")
        package.closed_at = datetime.now(UTC)
        db.commit()
    forbidden_ready = _post(client, story_id, "production/titles/ready", "orion")
    ready = _post(client, story_id, "production/titles/ready", "runa")
    duplicate_ready = _post(client, story_id, "production/titles/ready", "astra")
    forbidden_accept = _post(client, story_id, "production/titles/accept", "runa")
    accepted = _post(client, story_id, "production/titles/accept", "astra")
    duplicate_accept = _post(client, story_id, "production/titles/accept", "iskra")
    assert forbidden_ready.status_code == 403 and _code(forbidden_ready) == "FORBIDDEN"
    assert ready.status_code == 200
    assert duplicate_ready.status_code == 409 and _code(duplicate_ready) == "TITLES_ALREADY_READY"
    assert forbidden_accept.status_code == 403 and _code(forbidden_accept) == "FORBIDDEN"
    assert accepted.status_code == 200
    assert duplicate_accept.status_code == 409 and _code(duplicate_accept) == "TITLES_ALREADY_ACCEPTED"


@pytest.mark.parametrize(
    ("path", "username", "body", "expected_code"),
    [
        ("production/video/start", "orion", {"revision": 99}, "REVISION_NOT_CURRENT"),
        ("production/video/ready", "orion", {}, "VIDEO_NOT_STARTED"),
        ("production/video/approve-for-titles", "astra", {}, "VIDEO_NOT_READY"),
        ("production/titles/start", "runa", {"revision": 0}, "TITLES_INITIAL_GATE_NOT_MET"),
        ("production/titles/ready", "runa", {}, "TITLES_NOT_STARTED"),
        ("production/titles/accept", "astra", {}, "TITLES_NOT_READY"),
    ],
)
def test_rejected_commands_leave_production_workflow_corrections_and_events_unchanged(
    client, path: str, username: str, body: dict, expected_code: str,
) -> None:
    story_id = _story_for_author()
    _assign(story_id, "video_editor", "orion")
    _assign(story_id, "designer", "runa")
    before = _snapshot(story_id)

    response = _post(client, story_id, path, username, body)

    assert response.status_code in {403, 409, 422}
    assert _code(response) == expected_code
    assert _snapshot(story_id) == before


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("PUT", "assignments/video_editor", {"user_id": 1}),
        ("DELETE", "assignments/video_editor", None),
        ("POST", "materials", {"title": "Материал", "location": "/media/path"}),
        ("POST", "production/voiceover/ready", {}),
        ("POST", "production/voiceover/not-ready", {"description": "Правка", "assignee_user_id": 1}),
        ("POST", "production/video/start", {"revision": 0}),
        ("POST", "production/video/ready", {}),
        ("POST", "production/video/approve-for-titles", {}),
        ("POST", "production/titles/start", {"revision": 0}),
        ("POST", "production/titles/ready", {}),
        ("POST", "production/titles/accept", {}),
    ],
)
def test_every_production_mutation_rejects_archived_story(client, method: str, path: str, body: dict | None) -> None:
    with SessionLocal() as db:
        story_id = db.query(Story.id).filter(Story.archived_at.is_not(None)).order_by(Story.id).first()[0]
    response = client.request(
        method,
        f"/api/v1/stories/{story_id}/{path}",
        json=body,
        cookies=_login(client, "astra"),
    )
    assert response.status_code == 409, response.text
    assert _code(response) == "STORY_ARCHIVED"
