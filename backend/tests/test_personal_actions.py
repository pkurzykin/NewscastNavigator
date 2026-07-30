from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.db.models import (
    CorrectionPackage,
    CorrectionPart,
    Scenario,
    Story,
    StoryAssignment,
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


def _user(db, username: str) -> User:
    return db.query(User).filter(User.username == username).one()


def _active_story(db, username: str) -> Story:
    user = _user(db, username)
    return (
        db.query(Story)
        .filter(Story.author_user_id == user.id, Story.archived_at.is_(None))
        .order_by(Story.id)
        .first()
    )


def test_personal_actions_are_union_deduped_server_actions_with_exact_urls(client) -> None:
    now = datetime.now(UTC)
    with SessionLocal() as db:
        combined = _user(db, "mayak")
        db.add_all(
            [
                UserFunction(user_id=combined.id, function_code="chief_editor"),
                UserFunction(user_id=combined.id, function_code="video_editor"),
                UserFunction(user_id=combined.id, function_code="designer"),
            ]
        )
        author_story = _active_story(db, "mayak")
        author_story.priority = "high"
        author_story.created_at = now - timedelta(minutes=3)

        leadership_story = _active_story(db, "lira")
        leadership_story.priority = "high"
        leadership_story.created_at = now - timedelta(minutes=2)
        leadership_state = db.get(StoryWorkflowState, leadership_story.id)
        leadership_state.review_requested_revision = 0
        leadership_state.review_requested_by_user_id = leadership_story.author_user_id
        leadership_state.review_requested_at = now

        production_story = _active_story(db, "iskra")
        production_story.priority = "standard"
        production_story.created_at = now - timedelta(minutes=1)
        selected_ids = {author_story.id, leadership_story.id, production_story.id}
        for unrelated in db.query(Story).filter(
            Story.archived_at.is_(None),
            Story.id.not_in(selected_ids),
        ):
            unrelated.aired_at = now
            unrelated.aired_by_user_id = _user(db, "astra").id
            unrelated.archived_at = now
            unrelated.archived_by_user_id = _user(db, "astra").id
        db.add_all(
            [
                StoryAssignment(
                    story_id=production_story.id,
                    kind="proofreader",
                    user_id=combined.id,
                    assigned_by_user_id=_user(db, "astra").id,
                ),
                StoryAssignment(
                    story_id=production_story.id,
                    kind="video_editor",
                    user_id=combined.id,
                    assigned_by_user_id=_user(db, "astra").id,
                ),
                StoryAssignment(
                    story_id=production_story.id,
                    kind="designer",
                    user_id=combined.id,
                    assigned_by_user_id=_user(db, "astra").id,
                ),
            ]
        )
        production = db.get(StoryProductionState, production_story.id)
        workflow = db.get(StoryWorkflowState, production_story.id)
        production.video_started_revision = 0
        production.video_started_by_user_id = combined.id
        production.video_started_at = now
        production.video_approved_for_titles_by_user_id = _user(db, "astra").id
        production.video_approved_for_titles_at = now
        workflow.editorial_revision = 0
        workflow.editorial_by_user_id = _user(db, "astra").id
        workflow.editorial_at = now
        workflow.proofread_revision = None

        package = CorrectionPackage(
            story_id=production_story.id,
            source="internal",
            created_by_user_id=_user(db, "astra").id,
            created_at=now,
        )
        db.add(package)
        db.flush()
        db.add_all(
            [
                CorrectionPart(
                    package_id=package.id,
                    scope="text",
                    description="Своя часть",
                    assignee_user_id=combined.id,
                ),
                CorrectionPart(
                    package_id=package.id,
                    scope="voiceover",
                    description="Чужая часть",
                    assignee_user_id=_user(db, "orion").id,
                ),
            ]
        )
        db.commit()
        author_story_id = author_story.id
        leadership_story_id = leadership_story.id
        production_story_id = production_story.id
        package_id = package.id

    response = client.get(
        "/api/v1/me/actions?limit=20",
        cookies=_login(client, "mayak"),
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert set(payload) == {"items", "total"}
    ids = [item["id"] for item in payload["items"]]
    assert len(ids) == len(set(ids))
    assert ids == [
        f"story:{leadership_story_id}:action:confirm_editorial",
        f"story:{author_story_id}:action:confirm_editorial",
        f"story:{production_story_id}:action:mark_proofread",
        f"story:{production_story_id}:action:video_ready",
        f"story:{production_story_id}:correction:{package_id}:part:{payload['items'][-1]['action']['part_id']}:complete",
    ]

    by_id = {item["id"]: item for item in payload["items"]}
    leadership = by_id[f"story:{leadership_story_id}:action:confirm_editorial"]
    assert leadership["target_href"] == f"/stories/{leadership_story_id}/scenario"
    assert leadership["action"]["href"] == f"/api/v1/stories/{leadership_story_id}/workflow/confirm-editorial"
    assert leadership["action"]["label"] == "Подтвердить редакционную готовность"

    own_ready = by_id[f"story:{author_story_id}:action:confirm_editorial"]
    assert own_ready["action"]["label"] == "Текст готов"
    assert own_ready["story"]["priority"] == {"code": "high", "label": "Высокий"}

    correction = payload["items"][-1]
    assert correction["target_href"] == f"/stories/{production_story_id}/production"
    assert correction["action"]["href"].endswith("/complete")
    assert correction["action"]["part_scope"] == "text"
    assert "Чужая часть" not in [item.get("summary") for item in payload["items"]]

    # General/discretionary actions from the production read model are intentionally absent.
    codes = [item["action"]["code"] for item in payload["items"]]
    assert "voiceover_ready" not in codes
    assert "correction_package_create" not in codes
    assert "correction_part_return" not in codes
    assert "video_correction_package" not in codes


def test_personal_action_order_limit_archive_and_leadership_decisions(client) -> None:
    now = datetime.now(UTC)
    with SessionLocal() as db:
        chief = _user(db, "astra")
        high_story = _active_story(db, "lira")
        standard_story = _active_story(db, "iskra")
        archived_story = db.query(Story).filter(Story.archived_at.is_not(None)).first()
        assert archived_story is not None
        selected_ids = {high_story.id, standard_story.id}
        for unrelated in db.query(Story).filter(
            Story.archived_at.is_(None),
            Story.id.not_in(selected_ids),
        ):
            unrelated.aired_at = now
            unrelated.aired_by_user_id = chief.id
            unrelated.archived_at = now
            unrelated.archived_by_user_id = chief.id

        high_story.priority = "high"
        high_story.created_at = now - timedelta(minutes=10)
        standard_story.priority = "standard"
        standard_story.created_at = now
        for story in (high_story, standard_story):
            workflow = db.get(StoryWorkflowState, story.id)
            workflow.review_requested_revision = 0
            workflow.review_requested_by_user_id = story.author_user_id
            workflow.review_requested_at = now
        high_workflow = db.get(StoryWorkflowState, high_story.id)
        high_workflow.editorial_revision = 0
        high_workflow.editorial_by_user_id = chief.id
        high_workflow.editorial_at = now
        high_workflow.proofread_revision = 0
        high_workflow.proofread_by_user_id = _user(db, "mayak").id
        high_workflow.proofread_at = now
        high_workflow.changed_after_proofread = True

        archived_workflow = db.get(StoryWorkflowState, archived_story.id)
        archived_workflow.review_requested_revision = 0
        archived_workflow.review_requested_by_user_id = archived_story.author_user_id
        archived_workflow.review_requested_at = now

        completed_package = CorrectionPackage(
            story_id=high_story.id,
            source="internal",
            created_by_user_id=chief.id,
            created_at=now,
        )
        db.add(completed_package)
        db.flush()
        db.add(
            CorrectionPart(
                package_id=completed_package.id,
                scope="text",
                description="Готовая часть",
                assignee_user_id=_user(db, "lira").id,
                state="done",
                completed_by_user_id=_user(db, "lira").id,
                completed_at=now,
            )
        )
        high_production = db.get(StoryProductionState, high_story.id)
        high_production.video_started_revision = 0
        high_production.video_started_by_user_id = _user(db, "orion").id
        high_production.video_started_at = now
        high_production.video_ready_by_user_id = _user(db, "orion").id
        high_production.video_ready_at = now
        db.commit()
        high_story_id = high_story.id
        standard_story_id = standard_story.id
        archived_story_id = archived_story.id
        package_id = completed_package.id

    response = client.get(
        "/api/v1/me/actions?limit=3",
        cookies=_login(client, "astra"),
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] >= 4
    assert len(payload["items"]) == 3
    assert [item["story"]["id"] for item in payload["items"]] == [
        high_story_id,
        high_story_id,
        high_story_id,
    ]
    assert [item["action"]["code"] for item in payload["items"]] == [
        "request_reproofread",
        "video_approve_for_titles",
        "correction_package_close",
    ]
    assert payload["items"][2]["id"] == f"story:{high_story_id}:correction:{package_id}:close"
    assert all(item["story"]["id"] != archived_story_id for item in payload["items"])

    all_items = client.get(
        "/api/v1/me/actions?limit=20",
        cookies=_login(client, "astra"),
    ).json()["items"]
    high_indices = [index for index, item in enumerate(all_items) if item["story"]["id"] == high_story_id]
    standard_indices = [index for index, item in enumerate(all_items) if item["story"]["id"] == standard_story_id]
    assert high_indices and standard_indices and max(high_indices) < min(standard_indices)
    assert all(item["story"]["id"] != archived_story_id for item in all_items)


def test_personal_actions_accepts_a_requested_full_total_above_the_preview_cap(client) -> None:
    response = client.get(
        "/api/v1/me/actions?limit=201",
        cookies=_login(client, "astra"),
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert len(payload["items"]) <= 201
    assert payload["total"] >= len(payload["items"])
