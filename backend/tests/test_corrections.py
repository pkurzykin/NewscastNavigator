from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.db.models import (
    CorrectionPackage,
    CorrectionPart,
    Story,
    StoryEvent,
    StoryProductionState,
    StoryWorkflowState,
    User,
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
        user_id = db.query(User.id).filter(User.username == username).scalar()
        assert user_id is not None
        return user_id


def _story_for_author(username: str = "lira", *, archived: bool = False) -> int:
    with SessionLocal() as db:
        author_id = db.query(User.id).filter(User.username == username).scalar()
        row = (
            db.query(Story.id)
            .filter(
                Story.author_user_id == author_id,
                Story.archived_at.is_not(None) if archived else Story.archived_at.is_(None),
            )
            .order_by(Story.id)
            .first()
        )
        assert row is not None
        return row[0]


def _post(client, story_id: int, path: str, username: str, body: dict | None = None):
    return client.post(
        f"/api/v1/stories/{story_id}/{path}",
        json={} if body is None else body,
        cookies=_login(client, username),
    )


def _get(client, story_id: int, username: str):
    return client.get(
        f"/api/v1/stories/{story_id}/correction-packages",
        cookies=_login(client, username),
    )


def _code(response) -> str:
    return response.json()["error"]["code"]


def _part(scope: str, assignee: str, description: str | None = None) -> dict:
    return {
        "scope": scope,
        "description": description or f"Исправить: {scope}",
        "assignee_user_id": _user_id(assignee),
    }


def _create(client, story_id: int, parts: list[dict], username: str = "astra"):
    return _post(
        client,
        story_id,
        "correction-packages",
        username,
        {"source": "internal", "parts": parts},
    )


def _package_snapshot(story_id: int) -> tuple[list[dict], list[dict], list[dict], dict, dict]:
    with SessionLocal() as db:
        packages = (
            db.query(CorrectionPackage)
            .filter(CorrectionPackage.story_id == story_id)
            .order_by(CorrectionPackage.id)
            .all()
        )
        package_ids = [item.id for item in packages]
        parts = (
            db.query(CorrectionPart)
            .filter(CorrectionPart.package_id.in_(package_ids or [-1]))
            .order_by(CorrectionPart.id)
            .all()
        )
        events = (
            db.query(StoryEvent)
            .filter(StoryEvent.story_id == story_id)
            .order_by(StoryEvent.id)
            .all()
        )
        production = db.get(StoryProductionState, story_id)
        workflow = db.get(StoryWorkflowState, story_id)
        assert production is not None and workflow is not None
        return (
            [
                {column.name: getattr(item, column.name) for column in CorrectionPackage.__table__.columns}
                for item in packages
            ],
            [
                {column.name: getattr(item, column.name) for column in CorrectionPart.__table__.columns}
                for item in parts
            ],
            [
                {column.name: getattr(item, column.name) for column in StoryEvent.__table__.columns}
                for item in events
            ],
            {
                column.name: getattr(production, column.name)
                for column in StoryProductionState.__table__.columns
            },
            {
                column.name: getattr(workflow, column.name)
                for column in StoryWorkflowState.__table__.columns
            },
        )


def test_get_returns_exact_whole_package_shape_order_actor_refs_and_server_actions(client) -> None:
    story_id = _story_for_author()
    now = datetime.now(UTC)
    with SessionLocal() as db:
        astra = db.query(User).filter(User.username == "astra").one()
        orion = db.query(User).filter(User.username == "orion").one()
        runa = db.query(User).filter(User.username == "runa").one()
        production = db.get(StoryProductionState, story_id)
        workflow = db.get(StoryWorkflowState, story_id)
        assert production is not None and workflow is not None
        production.video_started_revision = 0
        production.video_started_by_user_id = orion.id
        production.video_started_at = now
        production.video_approved_for_titles_by_user_id = astra.id
        production.video_approved_for_titles_at = now
        production.titles_started_revision = 0
        production.titles_started_by_user_id = runa.id
        production.titles_started_at = now
        workflow.editorial_revision = 0
        workflow.editorial_by_user_id = astra.id
        workflow.editorial_at = now
        workflow.proofread_revision = 0
        workflow.proofread_by_user_id = astra.id
        workflow.proofread_at = now
        external = CorrectionPackage(
            story_id=story_id,
            source="external",
            created_by_user_id=astra.id,
            created_at=now - timedelta(minutes=2),
        )
        internal = CorrectionPackage(
            story_id=story_id,
            source="internal",
            created_by_user_id=astra.id,
            created_at=now - timedelta(minutes=1),
        )
        db.add_all([external, internal])
        db.flush()
        # Insert deliberately out of scope order: the public order must be the stable row ID order.
        db.add_all(
            [
                CorrectionPart(
                    package_id=external.id,
                    scope="titles",
                    description="Поправить географию титров",
                    assignee_user_id=runa.id,
                ),
                CorrectionPart(
                    package_id=external.id,
                    scope="video",
                    description="Заменить финальный план",
                    assignee_user_id=orion.id,
                ),
                CorrectionPart(
                    package_id=internal.id,
                    scope="text",
                    description="Уточнить формулировку",
                    assignee_user_id=orion.id,
                    state="done",
                    completed_by_user_id=orion.id,
                    completed_at=now,
                ),
            ]
        )
        db.commit()

    response = _get(client, story_id, "astra")
    assert response.status_code == 200, response.text
    payload = response.json()

    assert set(payload) == {"story_id", "items", "assignee_options", "create_action"}
    assert payload["story_id"] == story_id
    assert [item["source"] for item in payload["items"]] == ["internal", "external"]
    internal_item, external_item = payload["items"]
    assert set(internal_item) == {
        "id", "source", "created_by", "created_at", "parts", "all_parts_complete",
        "awaiting_leadership_review", "closed_by", "closed_at", "primary_action",
        "additional_actions",
    }
    assert set(internal_item["parts"][0]) == {
        "id", "scope", "description", "assignee", "state", "completed_by", "completed_at",
    }
    assert internal_item["created_by"]["username"] == "astra"
    assert internal_item["parts"][0]["assignee"]["username"] == "orion"
    assert internal_item["parts"][0]["completed_by"]["username"] == "orion"
    assert internal_item["all_parts_complete"] is True
    assert internal_item["awaiting_leadership_review"] is True
    assert internal_item["closed_at"] is None
    assert internal_item["primary_action"]["code"] == "correction_package_close"
    assert internal_item["primary_action"]["emphasis"] == "primary"
    assert [action["code"] for action in internal_item["additional_actions"]] == [
        "correction_part_return"
    ]
    assert [part["id"] for part in external_item["parts"]] == sorted(
        part["id"] for part in external_item["parts"]
    )
    assert [action["code"] for action in [external_item["primary_action"], *external_item["additional_actions"]]] == [
        "correction_part_complete", "correction_part_complete"
    ]
    assert external_item["primary_action"]["label"] == "Правки выполнены — титры готовы"
    assert external_item["additional_actions"][0]["label"] == "Правки выполнены — ролик готов"
    assert payload["create_action"]["form"] == "correction_package"
    assert {item["username"] for item in payload["assignee_options"]} >= {"orion", "runa"}

    readonly = _get(client, story_id, "sfera").json()
    assert readonly["create_action"] is None
    assert readonly["assignee_options"] == []
    assert all(
        item["primary_action"] is None and item["additional_actions"] == []
        for item in readonly["items"]
    )


def test_create_validates_parts_scope_description_assignee_permission_and_archive(client) -> None:
    story_id = _story_for_author()
    archived_id = _story_for_author(archived=True)
    missing_id = 999_999

    empty = _create(client, story_id, [])
    invalid_scope = _create(client, story_id, [_part("audio", "orion")])
    blank = _create(client, story_id, [_part("text", "orion", "   ")])
    missing_assignee = _create(
        client,
        story_id,
        [{"scope": "text", "description": "Исправить вводку", "assignee_user_id": 999_999}],
    )
    forbidden = _create(client, story_id, [_part("text", "orion")], username="lira")
    missing_story = _create(client, missing_id, [_part("text", "orion")])
    archived = _create(client, archived_id, [_part("text", "orion")])
    with SessionLocal() as db:
        inactive = db.query(User).filter(User.username == "orion").one()
        inactive.is_active = False
        db.commit()
    inactive_assignee = _create(client, story_id, [_part("text", "orion")])

    assert empty.status_code == 422 and _code(empty) == "CORRECTION_PARTS_REQUIRED"
    assert invalid_scope.status_code == 422 and _code(invalid_scope) == "CORRECTION_SCOPE_INVALID"
    assert blank.status_code == 422 and _code(blank) == "VALIDATION_ERROR"
    assert missing_assignee.status_code == 422 and _code(missing_assignee) == "ASSIGNEE_INVALID"
    assert forbidden.status_code == 403 and _code(forbidden) == "FORBIDDEN"
    assert missing_story.status_code == 404 and _code(missing_story) == "STORY_NOT_FOUND"
    assert archived.status_code == 409 and _code(archived) == "STORY_ARCHIVED"
    assert inactive_assignee.status_code == 422 and _code(inactive_assignee) == "ASSIGNEE_INVALID"


def test_public_internal_creation_is_atomic_and_external_multi_part_uses_reusable_service(client) -> None:
    story_id = _story_for_author()
    created = _create(client, story_id, [_part("text", "mayak", "  Проверить вводку  ")])
    assert created.status_code == 200, created.text
    assert created.json()["resource"]["type"] == "correction_package"
    public_package_id = created.json()["resource"]["id"]

    from app.services.correction_service import CorrectionPartInput, create_correction_package

    with SessionLocal() as db:
        actor = db.query(User).filter(User.username == "astra").one()
        package, event, _changed_at = create_correction_package(
            db,
            story_id=story_id,
            actor=actor,
            source="external",
            parts=[
                CorrectionPartInput(
                    scope="video",
                    description="Заменить план",
                    assignee_user_id=_user_id("orion"),
                ),
                CorrectionPartInput(
                    scope="titles",
                    description="Поправить подпись",
                    assignee_user_id=_user_id("runa"),
                ),
            ],
        )
        db.commit()
        external_package_id = package.id
        external_event_id = event.id

    with SessionLocal() as db:
        public = db.get(CorrectionPackage, public_package_id)
        external = db.get(CorrectionPackage, external_package_id)
        assert public is not None and public.source == "internal"
        public_parts = db.query(CorrectionPart).filter_by(package_id=public.id).all()
        assert len(public_parts) == 1
        assert public_parts[0].description == "Проверить вводку"
        assert external is not None and external.source == "external"
        assert db.query(CorrectionPart).filter_by(package_id=external.id).count() == 2
        assert db.get(StoryEvent, external_event_id).event_code == "correction_package_created"
        assert db.query(StoryEvent).filter_by(story_id=story_id).count() == 2


def test_creation_resets_returned_production_scopes_but_preserves_started_and_text_marks(client) -> None:
    story_id = _story_for_author()
    now = datetime.now(UTC)
    with SessionLocal() as db:
        production = db.get(StoryProductionState, story_id)
        workflow = db.get(StoryWorkflowState, story_id)
        assert production is not None and workflow is not None
        production.voiceover_ready = True
        production.voiceover_ready_by_user_id = _user_id("sfera")
        production.voiceover_ready_at = now
        production.video_started_revision = 0
        production.video_started_by_user_id = _user_id("orion")
        production.video_started_at = now
        production.video_ready_by_user_id = _user_id("orion")
        production.video_ready_at = now
        production.video_approved_for_titles_by_user_id = _user_id("astra")
        production.video_approved_for_titles_at = now
        production.titles_started_revision = 0
        production.titles_started_by_user_id = _user_id("runa")
        production.titles_started_at = now
        production.titles_ready_by_user_id = _user_id("runa")
        production.titles_ready_at = now
        production.titles_accepted_by_user_id = _user_id("astra")
        production.titles_accepted_at = now
        workflow.editorial_revision = 0
        workflow.editorial_by_user_id = _user_id("astra")
        workflow.editorial_at = now
        workflow.proofread_revision = 0
        workflow.proofread_by_user_id = _user_id("mayak")
        workflow.proofread_at = now
        db.commit()

    response = _create(
        client,
        story_id,
        [
            _part("video", "orion"),
            _part("titles", "runa"),
            _part("voiceover", "sfera"),
            _part("text", "mayak"),
        ],
    )
    assert response.status_code == 200, response.text

    with SessionLocal() as db:
        production = db.get(StoryProductionState, story_id)
        workflow = db.get(StoryWorkflowState, story_id)
        assert production is not None and workflow is not None
        assert production.video_started_at is not None
        assert production.video_ready_at is None
        assert production.video_approved_for_titles_at is None
        assert production.titles_started_at is not None
        assert production.titles_ready_at is None
        assert production.titles_accepted_at is None
        assert production.voiceover_ready is False
        assert production.voiceover_ready_by_user_id is None
        assert production.voiceover_ready_at is None
        assert workflow.editorial_revision == 0
        assert workflow.proofread_revision == 0


def test_complete_enforces_exact_relationship_permission_state_and_scope_action(client) -> None:
    first_story = _story_for_author("lira")
    second_story = _story_for_author("mayak")
    with SessionLocal() as db:
        production = db.get(StoryProductionState, first_story)
        assert production is not None
        production.video_started_revision = 0
        production.video_started_by_user_id = _user_id("orion")
        production.video_started_at = datetime.now(UTC)
        db.commit()
    first = _create(client, first_story, [_part("video", "orion")]).json()["resource"]["id"]
    second = _create(client, first_story, [_part("text", "mayak")]).json()["resource"]["id"]
    other_story_package = _create(
        client, second_story, [_part("titles", "runa")]
    ).json()["resource"]["id"]
    with SessionLocal() as db:
        first_part = db.query(CorrectionPart).filter_by(package_id=first).one().id
        second_part = db.query(CorrectionPart).filter_by(package_id=second).one().id
        other_part = db.query(CorrectionPart).filter_by(package_id=other_story_package).one().id

    forbidden = _post(
        client, first_story,
        f"correction-packages/{first}/parts/{first_part}/complete",
        "sfera", {"completion_action": "video_ready"},
    )
    mismatch = _post(
        client, first_story,
        f"correction-packages/{first}/parts/{first_part}/complete",
        "orion", {"completion_action": "titles_ready"},
    )
    cross_package = _post(
        client, first_story,
        f"correction-packages/{first}/parts/{second_part}/complete",
        "astra", {"completion_action": "none"},
    )
    cross_story = _post(
        client, first_story,
        f"correction-packages/{other_story_package}/parts/{other_part}/complete",
        "astra", {"completion_action": "none"},
    )
    completed = _post(
        client, first_story,
        f"correction-packages/{first}/parts/{first_part}/complete",
        "orion", {"completion_action": "video_ready"},
    )
    duplicate = _post(
        client, first_story,
        f"correction-packages/{first}/parts/{first_part}/complete",
        "astra", {"completion_action": "video_ready"},
    )
    closed = _post(client, first_story, f"correction-packages/{first}/close", "astra")
    immutable = _post(
        client, first_story,
        f"correction-packages/{first}/parts/{first_part}/complete",
        "astra", {"completion_action": "none"},
    )

    assert forbidden.status_code == 403 and _code(forbidden) == "PART_NOT_ASSIGNED"
    assert mismatch.status_code == 409 and _code(mismatch) == "COMPLETION_ACTION_SCOPE_MISMATCH"
    assert cross_package.status_code == 404 and _code(cross_package) == "CORRECTION_PART_NOT_FOUND"
    assert cross_story.status_code == 404 and _code(cross_story) == "CORRECTION_PACKAGE_NOT_FOUND"
    assert completed.status_code == 200
    assert duplicate.status_code == 409 and _code(duplicate) == "PART_ALREADY_COMPLETE"
    assert closed.status_code == 200
    assert immutable.status_code == 409 and _code(immutable) == "PACKAGE_CLOSED"


def test_combined_video_completion_requires_started_video_without_mutation(client) -> None:
    story_id = _story_for_author()
    package_id = _create(client, story_id, [_part("video", "orion")]).json()["resource"]["id"]
    with SessionLocal() as db:
        part_id = db.query(CorrectionPart.id).filter_by(package_id=package_id).scalar()
    before = _package_snapshot(story_id)

    response = _post(
        client,
        story_id,
        f"correction-packages/{package_id}/parts/{part_id}/complete",
        "orion",
        {"completion_action": "video_ready"},
    )

    assert response.status_code == 409 and _code(response) == "VIDEO_NOT_STARTED"
    assert _package_snapshot(story_id) == before


def test_combined_titles_completion_requires_started_titles_without_mutation(client) -> None:
    story_id = _story_for_author()
    now = datetime.now(UTC)
    with SessionLocal() as db:
        production = db.get(StoryProductionState, story_id)
        workflow = db.get(StoryWorkflowState, story_id)
        assert production is not None and workflow is not None
        workflow.editorial_revision = 0
        workflow.editorial_by_user_id = _user_id("astra")
        workflow.editorial_at = now
        workflow.proofread_revision = 0
        workflow.proofread_by_user_id = _user_id("mayak")
        workflow.proofread_at = now
        production.video_approved_for_titles_by_user_id = _user_id("astra")
        production.video_approved_for_titles_at = now
        db.commit()
    package_id = _create(client, story_id, [_part("titles", "runa")]).json()["resource"]["id"]
    with SessionLocal() as db:
        part_id = db.query(CorrectionPart.id).filter_by(package_id=package_id).scalar()
    before = _package_snapshot(story_id)

    response = _post(
        client,
        story_id,
        f"correction-packages/{package_id}/parts/{part_id}/complete",
        "runa",
        {"completion_action": "titles_ready"},
    )

    assert response.status_code == 409 and _code(response) == "TITLES_NOT_STARTED"
    assert _package_snapshot(story_id) == before


@pytest.mark.parametrize(
    "missing_gate",
    ["editorial", "proofread", "video_approval"],
)
def test_combined_titles_completion_requires_full_initial_gate_without_mutation(
    client,
    missing_gate: str,
) -> None:
    story_id = _story_for_author()
    now = datetime.now(UTC)
    with SessionLocal() as db:
        production = db.get(StoryProductionState, story_id)
        workflow = db.get(StoryWorkflowState, story_id)
        assert production is not None and workflow is not None
        production.titles_started_revision = 0
        production.titles_started_by_user_id = _user_id("runa")
        production.titles_started_at = now
        if missing_gate != "editorial":
            workflow.editorial_revision = 0
            workflow.editorial_by_user_id = _user_id("astra")
            workflow.editorial_at = now
        if missing_gate != "proofread":
            workflow.proofread_revision = 0
            workflow.proofread_by_user_id = _user_id("mayak")
            workflow.proofread_at = now
        if missing_gate != "video_approval":
            production.video_approved_for_titles_by_user_id = _user_id("astra")
            production.video_approved_for_titles_at = now
        db.commit()
    package_id = _create(client, story_id, [_part("titles", "runa")]).json()["resource"]["id"]
    with SessionLocal() as db:
        part_id = db.query(CorrectionPart.id).filter_by(package_id=package_id).scalar()
    before = _package_snapshot(story_id)

    response = _post(
        client,
        story_id,
        f"correction-packages/{package_id}/parts/{part_id}/complete",
        "runa",
        {"completion_action": "titles_ready"},
    )

    assert response.status_code == 409 and _code(response) == "TITLES_INITIAL_GATE_NOT_MET"
    assert _package_snapshot(story_id) == before


def test_combined_actions_are_absent_until_production_prerequisites_are_met(client) -> None:
    story_id = _story_for_author()
    package_id = _create(
        client,
        story_id,
        [_part("video", "orion"), _part("titles", "runa")],
    ).json()["resource"]["id"]

    unavailable = _get(client, story_id, "astra").json()["items"][0]
    assert unavailable["id"] == package_id
    assert unavailable["primary_action"] is None
    assert unavailable["additional_actions"] == []

    now = datetime.now(UTC)
    with SessionLocal() as db:
        production = db.get(StoryProductionState, story_id)
        workflow = db.get(StoryWorkflowState, story_id)
        assert production is not None and workflow is not None
        production.video_started_revision = 0
        production.video_started_by_user_id = _user_id("orion")
        production.video_started_at = now
        production.titles_started_revision = 0
        production.titles_started_by_user_id = _user_id("runa")
        production.titles_started_at = now
        workflow.editorial_revision = 0
        workflow.editorial_by_user_id = _user_id("astra")
        workflow.editorial_at = now
        workflow.proofread_revision = 0
        workflow.proofread_by_user_id = _user_id("mayak")
        workflow.proofread_at = now
        production.video_approved_for_titles_by_user_id = _user_id("astra")
        production.video_approved_for_titles_at = now
        db.commit()

    available = _get(client, story_id, "astra").json()["items"][0]
    assert [
        action["part_scope"]
        for action in [available["primary_action"], *available["additional_actions"]]
    ] == ["video", "titles"]


def test_prestart_video_package_uses_public_start_then_combined_ready(client) -> None:
    story_id = _story_for_author()
    package_id = _create(client, story_id, [_part("video", "orion")]).json()["resource"]["id"]
    with SessionLocal() as db:
        part_id = db.query(CorrectionPart.id).filter_by(package_id=package_id).scalar()

    before_start = _get(client, story_id, "orion").json()["items"][0]
    production_before = client.get(
        f"/api/v1/stories/{story_id}/production",
        cookies=_login(client, "astra"),
    ).json()
    before_codes = {
        action["code"]
        for action in [production_before["primary_action"], *production_before["additional_actions"]]
        if action is not None
    }
    started = _post(client, story_id, "production/video/start", "astra", {"revision": 0})
    direct_ready = _post(client, story_id, "production/video/ready", "astra")
    after_start = _get(client, story_id, "orion").json()["items"][0]
    completed = _post(
        client,
        story_id,
        f"correction-packages/{package_id}/parts/{part_id}/complete",
        "orion",
        {"completion_action": "video_ready"},
    )

    assert before_start["primary_action"] is None
    assert before_start["additional_actions"] == []
    assert "video_start" in before_codes
    assert started.status_code == 200
    assert direct_ready.status_code == 409 and _code(direct_ready) == "OPEN_VIDEO_CORRECTION_EXISTS"
    assert after_start["primary_action"]["part_scope"] == "video"
    assert completed.status_code == 200


def test_prestart_titles_package_uses_public_initial_gates_start_and_combined_ready(client) -> None:
    story_id = _story_for_author()
    package_id = _create(client, story_id, [_part("titles", "runa")]).json()["resource"]["id"]
    with SessionLocal() as db:
        part_id = db.query(CorrectionPart.id).filter_by(package_id=package_id).scalar()

    before_start = _get(client, story_id, "runa").json()["items"][0]
    assert _post(
        client,
        story_id,
        "workflow/confirm-editorial",
        "astra",
        {"revision": 0},
    ).status_code == 200
    assert _post(
        client,
        story_id,
        "workflow/mark-proofread",
        "astra",
        {"revision": 0},
    ).status_code == 200
    assert _post(
        client,
        story_id,
        "production/video/start",
        "astra",
        {"revision": 0},
    ).status_code == 200
    assert _post(client, story_id, "production/video/ready", "astra").status_code == 200
    assert _post(
        client,
        story_id,
        "production/video/approve-for-titles",
        "astra",
    ).status_code == 200
    production_ready = client.get(
        f"/api/v1/stories/{story_id}/production",
        cookies=_login(client, "astra"),
    ).json()
    ready_codes = {
        action["code"]
        for action in [production_ready["primary_action"], *production_ready["additional_actions"]]
        if action is not None
    }
    started = _post(client, story_id, "production/titles/start", "astra", {"revision": 0})
    direct_ready = _post(client, story_id, "production/titles/ready", "astra")
    after_start = _get(client, story_id, "runa").json()["items"][0]
    completed = _post(
        client,
        story_id,
        f"correction-packages/{package_id}/parts/{part_id}/complete",
        "runa",
        {"completion_action": "titles_ready"},
    )

    assert before_start["primary_action"] is None
    assert before_start["additional_actions"] == []
    assert "titles_start" in ready_codes
    assert started.status_code == 200
    assert direct_ready.status_code == 409 and _code(direct_ready) == "OPEN_TITLES_CORRECTION_EXISTS"
    assert after_start["primary_action"]["part_scope"] == "titles"
    assert completed.status_code == 200


def test_combined_video_and_titles_completion_atomically_sets_ready_and_last_part_waits_for_review(client) -> None:
    story_id = _story_for_author()
    now = datetime.now(UTC)
    with SessionLocal() as db:
        production = db.get(StoryProductionState, story_id)
        workflow = db.get(StoryWorkflowState, story_id)
        assert production is not None and workflow is not None
        production.video_started_revision = 0
        production.video_started_by_user_id = _user_id("orion")
        production.video_started_at = now
        production.titles_started_revision = 0
        production.titles_started_by_user_id = _user_id("runa")
        production.titles_started_at = now
        workflow.editorial_revision = 0
        workflow.editorial_by_user_id = _user_id("astra")
        workflow.editorial_at = now
        workflow.proofread_revision = 0
        workflow.proofread_by_user_id = _user_id("mayak")
        workflow.proofread_at = now
        db.commit()

    package_id = _create(
        client,
        story_id,
        [_part("video", "orion"), _part("titles", "runa")],
    ).json()["resource"]["id"]
    with SessionLocal() as db:
        parts = db.query(CorrectionPart).filter_by(package_id=package_id).order_by(CorrectionPart.id).all()
        video_part_id, titles_part_id = [part.id for part in parts]

    video = _post(
        client, story_id,
        f"correction-packages/{package_id}/parts/{video_part_id}/complete",
        "orion", {"completion_action": "video_ready"},
    )
    leadership_actions = client.get(
        f"/api/v1/stories/{story_id}/production",
        cookies=_login(client, "astra"),
    ).json()
    leadership_action_codes = {
        action["code"]
        for action in [
            leadership_actions["primary_action"],
            *leadership_actions["additional_actions"],
        ]
        if action is not None
    }
    approved = _post(client, story_id, "production/video/approve-for-titles", "astra")
    halfway = _get(client, story_id, "astra").json()["items"][0]
    titles = _post(
        client, story_id,
        f"correction-packages/{package_id}/parts/{titles_part_id}/complete",
        "runa", {"completion_action": "titles_ready"},
    )
    finished = _get(client, story_id, "astra").json()["items"][0]

    assert video.status_code == 200
    assert "video_approve_for_titles" in leadership_action_codes
    assert approved.status_code == 200
    assert titles.status_code == 200
    assert halfway["all_parts_complete"] is False
    assert halfway["awaiting_leadership_review"] is False
    assert finished["all_parts_complete"] is True
    assert finished["awaiting_leadership_review"] is True
    assert finished["closed_at"] is None
    assert finished["primary_action"]["code"] == "correction_package_close"
    with SessionLocal() as db:
        production = db.get(StoryProductionState, story_id)
        package = db.get(CorrectionPackage, package_id)
        assert production is not None and package is not None
        assert production.video_ready_by_user_id == _user_id("orion")
        assert production.video_ready_at is not None
        assert production.video_approved_for_titles_by_user_id == _user_id("astra")
        assert production.video_approved_for_titles_at is not None
        assert production.titles_ready_by_user_id == _user_id("runa")
        assert production.titles_ready_at is not None
        assert production.titles_accepted_at is None
        assert package.closed_at is None
        assert db.query(StoryEvent).filter_by(story_id=story_id).count() == 4


def test_return_requires_leadership_reason_done_part_and_resets_production_without_overwriting_description(client) -> None:
    story_id = _story_for_author()
    now = datetime.now(UTC)
    with SessionLocal() as db:
        production = db.get(StoryProductionState, story_id)
        assert production is not None
        production.video_started_revision = 0
        production.video_started_by_user_id = _user_id("orion")
        production.video_started_at = now
        db.commit()
    package_id = _create(client, story_id, [_part("video", "orion", "Исходное описание")]).json()["resource"]["id"]
    with SessionLocal() as db:
        part_id = db.query(CorrectionPart.id).filter_by(package_id=package_id).scalar()
    assert _post(
        client, story_id, f"correction-packages/{package_id}/parts/{part_id}/complete",
        "orion", {"completion_action": "video_ready"},
    ).status_code == 200

    forbidden = _post(
        client, story_id, f"correction-packages/{package_id}/parts/{part_id}/return",
        "orion", {"reason": "Нужно ещё поправить"},
    )
    blank = _post(
        client, story_id, f"correction-packages/{package_id}/parts/{part_id}/return",
        "astra", {"reason": "   "},
    )
    returned = _post(
        client, story_id, f"correction-packages/{package_id}/parts/{part_id}/return",
        "astra", {"reason": "  Остался резкий переход  "},
    )
    duplicate = _post(
        client, story_id, f"correction-packages/{package_id}/parts/{part_id}/return",
        "astra", {"reason": "Снова"},
    )

    assert forbidden.status_code == 403 and _code(forbidden) == "FORBIDDEN"
    assert blank.status_code == 422 and _code(blank) == "RETURN_REASON_REQUIRED"
    assert returned.status_code == 200
    assert duplicate.status_code == 409 and _code(duplicate) == "PART_NOT_COMPLETE"
    with SessionLocal() as db:
        part = db.get(CorrectionPart, part_id)
        production = db.get(StoryProductionState, story_id)
        event = (
            db.query(StoryEvent)
            .filter_by(story_id=story_id, event_code="correction_part_returned")
            .one()
        )
        assert part is not None and production is not None
        assert part.state == "pending"
        assert part.completed_by_user_id is None and part.completed_at is None
        assert part.description == "Исходное описание"
        assert production.video_ready_at is None
        assert event.payload["reason"] == "Остался резкий переход"
        assert event.payload["part_id"] == part_id


def test_close_requires_complete_is_leadership_and_closed_package_is_immutable(client) -> None:
    story_id = _story_for_author()
    package_id = _create(client, story_id, [_part("text", "mayak")]).json()["resource"]["id"]
    with SessionLocal() as db:
        part_id = db.query(CorrectionPart.id).filter_by(package_id=package_id).scalar()

    incomplete = _post(client, story_id, f"correction-packages/{package_id}/close", "astra")
    assert _post(
        client, story_id, f"correction-packages/{package_id}/parts/{part_id}/complete",
        "mayak", {"completion_action": "none"},
    ).status_code == 200
    forbidden = _post(client, story_id, f"correction-packages/{package_id}/close", "mayak")
    closed = _post(client, story_id, f"correction-packages/{package_id}/close", "iskra")
    duplicate = _post(client, story_id, f"correction-packages/{package_id}/close", "astra")
    returned = _post(
        client, story_id, f"correction-packages/{package_id}/parts/{part_id}/return",
        "astra", {"reason": "Поздно"},
    )

    assert incomplete.status_code == 409 and _code(incomplete) == "PACKAGE_HAS_INCOMPLETE_PARTS"
    assert forbidden.status_code == 403 and _code(forbidden) == "FORBIDDEN"
    assert closed.status_code == 200
    assert duplicate.status_code == 409 and _code(duplicate) == "PACKAGE_ALREADY_CLOSED"
    assert returned.status_code == 409 and _code(returned) == "PACKAGE_CLOSED"
    with SessionLocal() as db:
        package = db.get(CorrectionPackage, package_id)
        assert package is not None
        assert package.closed_by_user_id == _user_id("iskra")
        assert package.closed_at is not None


def test_rejected_commands_leave_package_production_workflow_and_events_unchanged(client) -> None:
    story_id = _story_for_author()
    package_id = _create(client, story_id, [_part("video", "orion")]).json()["resource"]["id"]
    with SessionLocal() as db:
        part_id = db.query(CorrectionPart.id).filter_by(package_id=package_id).scalar()
    before = _package_snapshot(story_id)

    rejected = [
        _post(
            client, story_id, f"correction-packages/{package_id}/parts/{part_id}/complete",
            "orion", {"completion_action": "titles_ready"},
        ),
        _post(
            client, story_id, f"correction-packages/{package_id}/parts/{part_id}/return",
            "astra", {"reason": "Нельзя вернуть pending"},
        ),
        _post(client, story_id, f"correction-packages/{package_id}/close", "astra"),
    ]
    assert all(response.status_code >= 400 for response in rejected)
    assert _package_snapshot(story_id) == before


def test_done_but_open_video_part_allows_post_ready_review_before_package_close(client) -> None:
    story_id = _story_for_author()
    now = datetime.now(UTC)
    with SessionLocal() as db:
        production = db.get(StoryProductionState, story_id)
        workflow = db.get(StoryWorkflowState, story_id)
        assert production is not None and workflow is not None
        production.video_started_revision = 0
        production.video_started_by_user_id = _user_id("orion")
        production.video_started_at = now
        workflow.editorial_revision = 0
        workflow.editorial_by_user_id = _user_id("astra")
        workflow.editorial_at = now
        workflow.proofread_revision = 0
        workflow.proofread_by_user_id = _user_id("mayak")
        workflow.proofread_at = now
        db.commit()

    package_id = _create(client, story_id, [_part("video", "orion")]).json()["resource"]["id"]
    with SessionLocal() as db:
        part_id = db.query(CorrectionPart.id).filter_by(package_id=package_id).scalar()
    assert _post(
        client, story_id, f"correction-packages/{package_id}/parts/{part_id}/complete",
        "orion", {"completion_action": "video_ready"},
    ).status_code == 200

    production_read = client.get(
        f"/api/v1/stories/{story_id}/production", cookies=_login(client, "astra")
    ).json()
    action_codes = {
        action["code"]
        for action in [production_read["primary_action"], *production_read["additional_actions"]]
        if action is not None
    }
    approved = _post(client, story_id, "production/video/approve-for-titles", "astra")

    assert "video_approve_for_titles" in action_codes
    assert approved.status_code == 200
    with SessionLocal() as db:
        package = db.get(CorrectionPackage, package_id)
        assert package is not None and package.closed_at is None


def test_archived_get_is_read_only_and_package_action_block_is_deterministically_ordered(client) -> None:
    story_id = _story_for_author()
    with SessionLocal() as db:
        production = db.get(StoryProductionState, story_id)
        assert production is not None
        production.video_started_revision = 0
        production.video_started_by_user_id = _user_id("orion")
        production.video_started_at = datetime.now(UTC)
        db.commit()
    package_id = _create(
        client,
        story_id,
        [_part("text", "mayak"), _part("video", "orion"), _part("voiceover", "sfera")],
    ).json()["resource"]["id"]
    with SessionLocal() as db:
        parts = db.query(CorrectionPart).filter_by(package_id=package_id).order_by(CorrectionPart.id).all()
        first_id, second_id, third_id = [part.id for part in parts]
    assert _post(
        client, story_id, f"correction-packages/{package_id}/parts/{first_id}/complete",
        "astra", {"completion_action": "none"},
    ).status_code == 200

    actions = _get(client, story_id, "astra").json()["items"][0]
    ordered = [actions["primary_action"], *actions["additional_actions"]]
    assert [action["code"] for action in ordered] == [
        "correction_part_complete", "correction_part_complete", "correction_part_return"
    ]
    assert [action.get("part_id") for action in ordered] == [second_id, third_id, first_id]
    assert sum(action["emphasis"] == "primary" for action in ordered) == 1

    with SessionLocal() as db:
        story = db.get(Story, story_id)
        assert story is not None
        story.aired_at = datetime.now(UTC)
        story.aired_by_user_id = _user_id("astra")
        story.archived_at = datetime.now(UTC)
        story.archived_by_user_id = _user_id("astra")
        db.commit()
    archived = _get(client, story_id, "astra")
    assert archived.status_code == 200
    assert archived.json()["create_action"] is None
    assert archived.json()["items"][0]["primary_action"] is None
    assert archived.json()["items"][0]["additional_actions"] == []


def test_cp4_voiceover_return_uses_generic_package_and_open_scope_blocks_manual_ready(client) -> None:
    story_id = _story_for_author()
    assert _post(client, story_id, "production/voiceover/ready", "sfera").status_code == 200
    returned = _post(
        client,
        story_id,
        "production/voiceover/not-ready",
        "astra",
        {"description": "  Перезаписать финал  ", "assignee_user_id": _user_id("sfera")},
    )
    assert returned.status_code == 200, returned.text

    packages = _get(client, story_id, "sfera")
    assert packages.status_code == 200, packages.text
    item = packages.json()["items"][0]
    assert item["source"] == "internal"
    assert item["parts"][0]["scope"] == "voiceover"
    assert item["parts"][0]["description"] == "Перезаписать финал"
    assert item["primary_action"]["code"] == "correction_part_complete"
    assert item["primary_action"]["part_scope"] == "voiceover"

    production = client.get(
        f"/api/v1/stories/{story_id}/production", cookies=_login(client, "sfera")
    ).json()
    action_codes = {
        action["code"]
        for action in [production["primary_action"], *production["additional_actions"]]
        if action is not None
    }
    direct = _post(client, story_id, "production/voiceover/ready", "sfera")
    assert "voiceover_ready" not in action_codes
    assert direct.status_code == 409 and _code(direct) == "INVALID_TRANSITION"


def test_production_review_actions_open_the_canonical_video_and_titles_package_form(client) -> None:
    story_id = _story_for_author()
    now = datetime.now(UTC)
    with SessionLocal() as db:
        production = db.get(StoryProductionState, story_id)
        workflow = db.get(StoryWorkflowState, story_id)
        assert production is not None and workflow is not None
        workflow.editorial_revision = 0
        workflow.editorial_by_user_id = _user_id("astra")
        workflow.editorial_at = now
        workflow.proofread_revision = 0
        workflow.proofread_by_user_id = _user_id("mayak")
        workflow.proofread_at = now
        production.video_started_revision = 0
        production.video_started_by_user_id = _user_id("orion")
        production.video_started_at = now
        production.video_ready_by_user_id = _user_id("orion")
        production.video_ready_at = now
        production.video_approved_for_titles_by_user_id = _user_id("astra")
        production.video_approved_for_titles_at = now
        production.titles_started_revision = 0
        production.titles_started_by_user_id = _user_id("runa")
        production.titles_started_at = now
        production.titles_ready_by_user_id = _user_id("runa")
        production.titles_ready_at = now
        db.commit()

    payload = client.get(
        f"/api/v1/stories/{story_id}/production", cookies=_login(client, "astra")
    ).json()
    actions = [
        action
        for action in [payload["primary_action"], *payload["additional_actions"]]
        if action is not None
    ]
    corrections = {
        action["code"]: action
        for action in actions
        if action["form"] == "correction_package"
    }
    assert set(corrections) >= {"video_correction_package", "titles_correction_package"}
    assert corrections["video_correction_package"]["label"] == "Вернуть ролик на правки"
    assert corrections["titles_correction_package"]["label"] == "Вернуть титры на правки"
    assert corrections["video_correction_package"]["href"] == (
        f"/api/v1/stories/{story_id}/correction-packages"
    )
    assert corrections["titles_correction_package"]["href"] == (
        f"/api/v1/stories/{story_id}/correction-packages"
    )
