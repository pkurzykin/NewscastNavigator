from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.db.models import Scenario, ScenarioEditSession, Story
from app.db.session import SessionLocal
from app.services.demo_seed import SYNTHETIC_DEMO_PASSWORD, seed_demo_data


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


def _active_story_id() -> int:
    with SessionLocal() as db:
        story = db.query(Story).filter(Story.archived_at.is_(None)).first()
        assert story is not None
        return story.id


def test_second_editor_is_held_until_expired_lease_is_reclaimed(client) -> None:
    story_id = _active_story_id()
    first = client.post(
        f"/api/v1/stories/{story_id}/scenario/lease",
        json={},
        cookies=_login(client, "lira"),
    )
    assert first.status_code == 200, first.text

    held = client.post(
        f"/api/v1/stories/{story_id}/scenario/lease",
        json={},
        cookies=_login(client, "orion"),
    )
    assert held.status_code == 409, held.text
    assert held.json()["error"]["code"] == "SCENARIO_LEASE_HELD"

    with SessionLocal() as db:
        scenario = db.query(Scenario).filter(Scenario.story_id == story_id).one()
        session = (
            db.query(ScenarioEditSession)
            .filter(ScenarioEditSession.scenario_id == scenario.id, ScenarioEditSession.ended_at.is_(None))
            .one()
        )
        session.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()

    reclaimed = client.post(
        f"/api/v1/stories/{story_id}/scenario/lease",
        json={},
        cookies=_login(client, "orion"),
    )
    assert reclaimed.status_code == 200, reclaimed.text
    assert reclaimed.json()["edit_session_id"] != first.json()["edit_session_id"]
