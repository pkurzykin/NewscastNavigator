from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.db.models import (
    Scenario,
    ScenarioReadMarker,
    Story,
    StoryAssignment,
    StoryMaterialLink,
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
        return db.query(User.id).filter(User.username == username).scalar()


def _story_for_author(username: str) -> int:
    with SessionLocal() as db:
        user_id = db.query(User.id).filter(User.username == username).scalar()
        row = (
            db.query(Story.id)
            .filter(Story.author_user_id == user_id, Story.archived_at.is_(None))
            .order_by(Story.id)
            .first()
        )
        story_id = row[0] if row is not None else None
        assert story_id is not None
        return story_id


def _get(client, story_id: int, username: str) -> dict:
    response = client.get(
        f"/api/v1/stories/{story_id}/production",
        cookies=_login(client, username),
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_production_read_model_has_exact_server_derived_shape_and_order(client) -> None:
    story_id = _story_for_author("lira")
    with SessionLocal() as db:
        chief_id = db.query(User.id).filter(User.username == "astra").scalar()
        proofreader_id = db.query(User.id).filter(User.username == "mayak").scalar()
        editor_id = db.query(User.id).filter(User.username == "orion").scalar()
        designer_id = db.query(User.id).filter(User.username == "runa").scalar()
        db.add_all(
            [
                StoryAssignment(story_id=story_id, kind="designer", user_id=designer_id, assigned_by_user_id=chief_id),
                StoryAssignment(story_id=story_id, kind="video_editor", user_id=editor_id, assigned_by_user_id=chief_id),
                StoryAssignment(story_id=story_id, kind="proofreader", user_id=proofreader_id, assigned_by_user_id=chief_id),
                StoryMaterialLink(story_id=story_id, title="Второй источник", location="/media/source-b", added_by_user_id=editor_id, added_at=datetime(2026, 7, 20, 10, 2, tzinfo=UTC)),
                StoryMaterialLink(story_id=story_id, title="Первый источник", location="https://media.example.invalid/source-a", added_by_user_id=proofreader_id, added_at=datetime(2026, 7, 20, 10, 1, tzinfo=UTC)),
            ]
        )
        db.commit()

    payload = _get(client, story_id, "astra")

    assert set(payload) == {
        "story",
        "scenario_revision",
        "assignments",
        "assignee_options",
        "can_manage_assignments",
        "materials",
        "corrections",
        "external_approval",
        "voiceover",
        "video",
        "titles",
        "aired",
        "stages",
        "primary_action",
        "additional_actions",
    }
    assert payload["external_approval"] == {
        "href": f"/api/v1/stories/{story_id}/external-approval/cycles",
        "total_count": 0,
        "pending_cycle_no": None,
        "last_result": None,
    }
    assert payload["scenario_revision"] == 0
    assert payload["corrections"] == {
        "href": f"/api/v1/stories/{story_id}/correction-packages",
        "total_count": 0,
        "open_count": 0,
        "awaiting_leadership_review_count": 0,
    }
    assert payload["story"]["id"] == story_id
    assert payload["story"]["title"].startswith("Учебный сюжет")
    assert payload["story"]["author"]["username"] == "lira"
    assert payload["story"]["aired_at"] is None
    assert set(payload["story"]) == {
        "id", "title", "priority", "rubric", "author", "situation", "assignments",
        "created_at", "aired_at", "archived_at", "primary_action", "additional_actions",
    }
    assert [item["kind"] for item in payload["assignments"]] == [
        "proofreader", "video_editor", "designer",
    ]
    material_titles = [item["title"] for item in payload["materials"]]
    assert material_titles.index("Первый источник") < material_titles.index("Второй источник")
    first_material = next(item for item in payload["materials"] if item["title"] == "Первый источник")
    assert first_material["added_by"]["username"] == "mayak"
    assert set(first_material) == {"id", "title", "location", "added_by", "added_at"}
    assert payload["voiceover"] == {"ready": False, "ready_by": None, "ready_at": None}
    assert payload["video"] == {
        "started_by": None,
        "started_at": None,
        "ready_by": None,
        "ready_at": None,
        "approved_for_titles_by": None,
        "approved_for_titles_at": None,
        "last_opened_revision": None,
        "has_unseen_scenario_changes": False,
    }
    assert payload["titles"]["initial_gate_satisfied"] is False
    assert payload["aired"] is None
    assert [stage["label"] for stage in payload["stages"]] == ["Озвучка", "Монтаж", "Титры"]
    assert all(stage["summary"] for stage in payload["stages"])
    actions = [payload["primary_action"], *payload["additional_actions"]]
    assert actions[0]["emphasis"] == "primary"
    assert all(action["emphasis"] == "normal" for action in actions[1:])
    assert {action["label"] for action in actions} >= {"Озвучка готова", "Начать монтаж"}
    assert len({action["code"] for action in actions}) == len(actions)
    assert payload["can_manage_assignments"] is True
    assert {option["username"] for option in payload["assignee_options"]} >= {"mayak", "orion", "runa"}


def test_read_markers_are_actor_specific_read_only_and_unseen_requires_active_track(client) -> None:
    story_id = _story_for_author("lira")
    with SessionLocal() as db:
        scenario = db.query(Scenario).filter(Scenario.story_id == story_id).one()
        scenario.revision_no = 5
        editor_id = db.query(User.id).filter(User.username == "orion").scalar()
        other_id = db.query(User.id).filter(User.username == "sfera").scalar()
        production = db.get(StoryProductionState, story_id)
        assert production is not None
        production.video_started_revision = 2
        production.video_started_by_user_id = editor_id
        production.video_started_at = datetime(2026, 7, 20, 9, 0, tzinfo=UTC)
        production.titles_started_revision = 3
        production.titles_started_by_user_id = editor_id
        production.titles_started_at = datetime(2026, 7, 20, 9, 30, tzinfo=UTC)
        db.add_all(
            [
                ScenarioReadMarker(story_id=story_id, user_id=editor_id, context="video", revision_no=3),
                ScenarioReadMarker(story_id=story_id, user_id=editor_id, context="titles", revision_no=5),
                ScenarioReadMarker(story_id=story_id, user_id=other_id, context="video", revision_no=5),
            ]
        )
        db.commit()

    editor = _get(client, story_id, "orion")
    unrelated = _get(client, story_id, "sfera")

    assert editor["video"]["last_opened_revision"] == 3
    assert editor["video"]["has_unseen_scenario_changes"] is True
    assert editor["titles"]["last_opened_revision"] == 5
    assert editor["titles"]["has_unseen_scenario_changes"] is False
    assert unrelated["video"]["last_opened_revision"] == 5
    assert unrelated["video"]["has_unseen_scenario_changes"] is False
    assert unrelated["titles"]["last_opened_revision"] is None
    assert unrelated["titles"]["has_unseen_scenario_changes"] is True
    with SessionLocal() as db:
        assert db.query(ScenarioReadMarker).filter(ScenarioReadMarker.story_id == story_id).count() == 3


@pytest.mark.parametrize(
    ("marker_revision", "scenario_revision", "expected_unseen"),
    [
        pytest.param(2, 3, False, id="marker-older-than-track-start"),
        pytest.param(3, 4, True, id="marker-equal-to-track-start"),
        pytest.param(4, 5, True, id="marker-newer-than-track-start"),
    ],
)
def test_unseen_baseline_is_latest_of_track_start_and_actor_marker(
    client,
    marker_revision: int,
    scenario_revision: int,
    expected_unseen: bool,
) -> None:
    story_id = _story_for_author("lira")
    editor_id = _user_id("orion")
    with SessionLocal() as db:
        scenario = db.query(Scenario).filter(Scenario.story_id == story_id).one()
        scenario.revision_no = scenario_revision
        production = db.get(StoryProductionState, story_id)
        assert production is not None
        production.video_started_revision = 3
        production.video_started_by_user_id = editor_id
        production.video_started_at = datetime(2026, 7, 20, 9, 0, tzinfo=UTC)
        production.titles_started_revision = 3
        production.titles_started_by_user_id = editor_id
        production.titles_started_at = datetime(2026, 7, 20, 9, 5, tzinfo=UTC)
        db.add_all(
            [ScenarioReadMarker(
                story_id=story_id,
                user_id=editor_id,
                context="video",
                revision_no=marker_revision,
            ), ScenarioReadMarker(
                story_id=story_id,
                user_id=editor_id,
                context="titles",
                revision_no=marker_revision,
            )]
        )
        db.commit()

    payload = _get(client, story_id, "orion")

    assert payload["video"]["last_opened_revision"] == marker_revision
    assert payload["video"]["has_unseen_scenario_changes"] is expected_unseen
    assert payload["titles"]["last_opened_revision"] == marker_revision
    assert payload["titles"]["has_unseen_scenario_changes"] is expected_unseen


def test_captionpanels_open_is_the_latest_titles_baseline_in_production(client) -> None:
    story_id = _story_for_author("lira")
    designer_id = _user_id("runa")
    with SessionLocal() as db:
        scenario = db.query(Scenario).filter(Scenario.story_id == story_id).one()
        scenario.revision_no = 5
        production = db.get(StoryProductionState, story_id)
        assert production is not None
        production.titles_started_revision = 3
        production.titles_started_by_user_id = designer_id
        production.titles_started_at = datetime(2026, 7, 20, 9, 5, tzinfo=UTC)
        db.commit()

    before = _get(client, story_id, "runa")
    imported = client.get(
        f"/api/v1/integrations/captionpanels/stories/{story_id}/import-json",
        cookies=_login(client, "runa"),
    )
    after = _get(client, story_id, "runa")

    assert before["titles"]["last_opened_revision"] is None
    assert before["titles"]["has_unseen_scenario_changes"] is True
    assert imported.status_code == 200, imported.text
    assert after["titles"]["last_opened_revision"] == 5
    assert after["titles"]["has_unseen_scenario_changes"] is False


def test_story_header_uses_server_derived_production_situation_and_standard_label(client) -> None:
    story_id = _story_for_author("lira")
    with SessionLocal() as db:
        story = db.get(Story, story_id)
        production = db.get(StoryProductionState, story_id)
        assert story is not None and production is not None
        story.priority = "standard"
        db.commit()

    initial = _get(client, story_id, "astra")
    assert initial["story"]["priority"] == {"code": "standard", "label": "Стандарт"}
    assert initial["story"]["situation"] == {
        "code": "production_pending",
        "label": "Производство не начато",
    }

    with SessionLocal() as db:
        production = db.get(StoryProductionState, story_id)
        assert production is not None
        production.video_started_at = datetime(2026, 7, 20, 9, 0, tzinfo=UTC)
        production.video_started_revision = 0
        db.commit()
    assert _get(client, story_id, "astra")["story"]["situation"] == {
        "code": "video_in_progress",
        "label": "Монтаж в работе",
    }

    with SessionLocal() as db:
        production = db.get(StoryProductionState, story_id)
        assert production is not None
        production.video_ready_at = datetime(2026, 7, 20, 9, 10, tzinfo=UTC)
        production.titles_started_at = datetime(2026, 7, 20, 9, 20, tzinfo=UTC)
        production.titles_started_revision = 0
        db.commit()
    assert _get(client, story_id, "astra")["story"]["situation"] == {
        "code": "titles_in_progress",
        "label": "Титры в работе",
    }

    with SessionLocal() as db:
        production = db.get(StoryProductionState, story_id)
        assert production is not None
        production.titles_ready_at = datetime(2026, 7, 20, 9, 30, tzinfo=UTC)
        production.titles_accepted_at = datetime(2026, 7, 20, 9, 40, tzinfo=UTC)
        db.commit()
    assert _get(client, story_id, "astra")["story"]["situation"] == {
        "code": "titles_accepted",
        "label": "Титры приняты",
    }


def test_archived_story_read_model_has_no_mutation_actions_or_management(client) -> None:
    with SessionLocal() as db:
        story_id = db.query(Story.id).filter(Story.archived_at.is_not(None)).order_by(Story.id).first()[0]
        assert story_id is not None

    payload = _get(client, story_id, "astra")

    assert payload["story"]["archived_at"] is not None
    assert payload["primary_action"] is None
    assert payload["additional_actions"] == []
    assert payload["story"]["primary_action"] is None
    assert payload["story"]["additional_actions"] == []
    assert payload["can_manage_assignments"] is False
    assert payload["assignee_options"] == []


def test_action_policy_exposes_only_allowed_transitions_with_one_primary(client) -> None:
    story_id = _story_for_author("lira")
    editor_id = _user_id("orion")
    chief_id = _user_id("astra")
    with SessionLocal() as db:
        db.add(StoryAssignment(story_id=story_id, kind="video_editor", user_id=editor_id, assigned_by_user_id=chief_id))
        db.commit()

    editor = _get(client, story_id, "orion")
    unrelated = _get(client, story_id, "sfera")

    editor_actions = [editor["primary_action"], *editor["additional_actions"]]
    unrelated_actions = [unrelated["primary_action"], *unrelated["additional_actions"]]
    assert [action["code"] for action in editor_actions] == ["voiceover_ready", "video_start"]
    assert [action["code"] for action in unrelated_actions] == ["voiceover_ready"]
    assert editor_actions[0]["emphasis"] == "primary"
    assert editor_actions[1]["emphasis"] == "normal"
    assert all(action["method"] == "POST" for action in editor_actions)
    assert editor_actions[1]["href"] == f"/api/v1/stories/{story_id}/production/video/start"
