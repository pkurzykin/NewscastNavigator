from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import event

from app.db.models import (
    CorrectionPackage,
    CorrectionPart,
    ExternalApprovalCycle,
    Notification,
    Story,
    StoryEvent,
    StoryProductionState,
    StoryWorkflowState,
    User,
)
from app.db.session import SessionLocal, engine
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


def _story(db, username: str = "lira") -> Story:
    author = _user(db, username)
    return (
        db.query(Story)
        .filter(Story.author_user_id == author.id, Story.archived_at.is_(None))
        .order_by(Story.id)
        .first()
    )


def _url(story_id: int) -> str:
    return f"/api/v1/stories/{story_id}/external-approval/cycles"


def _send(client, story_id: int, username: str = "astra"):
    return client.post(f"{_url(story_id)}/send", json={}, cookies=_login(client, username))


def _result(client, story_id: int, cycle_id: int, payload: dict, username: str = "astra"):
    result = payload["result"]
    if result == "approved":
        path = "approved"
        body = {}
    else:
        path = "changes-requested"
        body = {"parts": payload["parts"]}
    return client.post(
        f"{_url(story_id)}/{cycle_id}/{path}",
        json=body,
        cookies=_login(client, username),
    )


def test_cycles_are_readable_by_active_users_and_mutations_are_leadership_only(client) -> None:
    with SessionLocal() as db:
        story_id = _story(db).id

    read = client.get(_url(story_id), cookies=_login(client, "lira"))
    assert read.status_code == 200, read.text
    assert read.json() == {
        "story_id": story_id,
        "items": [],
        "assignee_options": [],
        "send_action": None,
    }

    forbidden = _send(client, story_id, "lira")
    assert forbidden.status_code == 403
    assert forbidden.json()["error"]["code"] == "FORBIDDEN"

    leadership = client.get(_url(story_id), cookies=_login(client, "astra"))
    assert leadership.status_code == 200
    assert leadership.json()["send_action"] == {
        "code": "external_approval_send",
        "label": "Отправить на внешнее согласование",
        "method": "POST",
        "href": f"{_url(story_id)}/send",
        "emphasis": "primary",
        "confirmation": None,
        "form": None,
    }
    assert leadership.json()["assignee_options"]


def test_send_creates_pending_cycle_event_actions_and_rejects_parallel_pending(client) -> None:
    with SessionLocal() as db:
        story_id = _story(db).id

    sent = _send(client, story_id)
    assert sent.status_code == 200, sent.text
    cycle_id = sent.json()["resource"]["id"]

    read = client.get(_url(story_id), cookies=_login(client, "astra"))
    assert read.status_code == 200
    cycle = read.json()["items"][0]
    assert cycle["id"] == cycle_id
    assert cycle["cycle_no"] == 1
    assert cycle["result"] == "pending"
    assert cycle["decided_by"] is None
    assert cycle["correction_package_id"] is None
    assert cycle["primary_action"] == {
        "code": "external_approval_approved",
        "label": "Согласовано",
        "method": "POST",
        "href": f"{_url(story_id)}/{cycle_id}/approved",
        "emphasis": "primary",
        "confirmation": None,
        "form": None,
    }
    assert cycle["additional_actions"][0]["code"] == "external_approval_changes_requested"
    assert cycle["additional_actions"][0]["href"] == (
        f"{_url(story_id)}/{cycle_id}/changes-requested"
    )
    assert cycle["additional_actions"][0]["form"] == "external_result"
    assert read.json()["send_action"] is None

    with SessionLocal() as db:
        event = db.query(StoryEvent).filter_by(story_id=story_id).order_by(StoryEvent.id.desc()).first()
        assert event.event_code == "external_approval_sent"
        assert event.payload == {"cycle_id": cycle_id, "cycle_no": 1}

    duplicate = _send(client, story_id)
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "EXTERNAL_CYCLE_ALREADY_PENDING"
    with SessionLocal() as db:
        assert db.query(ExternalApprovalCycle).filter_by(story_id=story_id).count() == 1


def test_send_rejects_any_open_correction_package(client) -> None:
    with SessionLocal() as db:
        story = _story(db)
        package = CorrectionPackage(
            story_id=story.id,
            source="internal",
            created_by_user_id=_user(db, "astra").id,
        )
        db.add(package)
        db.commit()
        story_id = story.id

    response = _send(client, story_id)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "OPEN_CORRECTION_PACKAGE_EXISTS"
    with SessionLocal() as db:
        assert db.query(ExternalApprovalCycle).filter_by(story_id=story_id).count() == 0


def test_approved_closes_only_the_requested_pending_cycle_and_notifies_other_leaders(client) -> None:
    with SessionLocal() as db:
        story_id = _story(db).id
        actor_id = _user(db, "astra").id
        other_leader_id = _user(db, "iskra").id

    cycle_id = _send(client, story_id).json()["resource"]["id"]
    approved = _result(
        client,
        story_id,
        cycle_id,
        {"result": "approved", "parts": []},
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["resource"] == {
        "type": "external_approval_cycle",
        "id": cycle_id,
    }

    with SessionLocal() as db:
        cycle = db.get(ExternalApprovalCycle, cycle_id)
        assert cycle.result == "approved"
        assert cycle.decided_by_user_id == actor_id
        assert cycle.decided_at is not None
        assert cycle.correction_package_id is None
        event = db.query(StoryEvent).filter_by(story_id=story_id).order_by(StoryEvent.id.desc()).first()
        assert event.event_code == "external_approval_approved"
        recipients = {
            item.recipient_user_id
            for item in db.query(Notification).filter_by(
                story_id=story_id,
                kind="external_approval_result",
            )
        }
        assert other_leader_id in recipients
        assert actor_id not in recipients

    repeat = _result(
        client,
        story_id,
        cycle_id,
        {"result": "approved", "parts": []},
    )
    assert repeat.status_code == 409
    assert repeat.json()["error"]["code"] == "EXTERNAL_CYCLE_NOT_PENDING"

    wrong = _result(
        client,
        story_id,
        cycle_id + 9999,
        {"result": "approved", "parts": []},
    )
    assert wrong.status_code == 409
    assert wrong.json()["error"]["code"] == "EXTERNAL_CYCLE_NOT_PENDING"


def test_changes_requested_rejects_empty_parts_through_shared_contract(client) -> None:
    with SessionLocal() as db:
        story_id = _story(db).id
    cycle_id = _send(client, story_id).json()["resource"]["id"]

    response = _result(
        client,
        story_id,
        cycle_id,
        {"result": "changes_requested", "parts": []},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "CORRECTION_PARTS_REQUIRED"
    with SessionLocal() as db:
        cycle = db.get(ExternalApprovalCycle, cycle_id)
        assert cycle.result == "pending"
        assert cycle.correction_package_id is None
        assert db.query(CorrectionPackage).filter_by(story_id=story_id).count() == 0


def test_changes_requested_atomically_creates_linked_external_multi_part_package(client) -> None:
    now = datetime.now(UTC)
    with SessionLocal() as db:
        story = _story(db)
        production = db.get(StoryProductionState, story.id)
        workflow = db.get(StoryWorkflowState, story.id)
        chief = _user(db, "astra")
        production.voiceover_ready = True
        production.voiceover_ready_by_user_id = chief.id
        production.voiceover_ready_at = now
        production.video_ready_by_user_id = chief.id
        production.video_ready_at = now
        production.video_approved_for_titles_by_user_id = chief.id
        production.video_approved_for_titles_at = now
        production.titles_ready_by_user_id = chief.id
        production.titles_ready_at = now
        production.titles_accepted_by_user_id = chief.id
        production.titles_accepted_at = now
        workflow.editorial_revision = 0
        workflow.proofread_revision = 0
        db.commit()
        story_id = story.id
        text_assignee_id = _user(db, "lira").id
        video_assignee_id = _user(db, "orion").id
        titles_assignee_id = _user(db, "runa").id

    cycle_id = _send(client, story_id).json()["resource"]["id"]
    response = _result(
        client,
        story_id,
        cycle_id,
        {
            "result": "changes_requested",
            "parts": [
                {
                    "scope": "text",
                    "description": "  Уточнить финальную формулировку  ",
                    "assignee_user_id": text_assignee_id,
                },
                {
                    "scope": "video",
                    "description": "Сократить синхрон",
                    "assignee_user_id": video_assignee_id,
                },
                {
                    "scope": "titles",
                    "description": "Исправить подпись",
                    "assignee_user_id": titles_assignee_id,
                },
            ],
        },
    )
    assert response.status_code == 200, response.text

    with SessionLocal() as db:
        cycle = db.get(ExternalApprovalCycle, cycle_id)
        package = db.get(CorrectionPackage, cycle.correction_package_id)
        assert cycle.result == "changes_requested"
        assert package.source == "external"
        assert package.story_id == story_id
        parts = db.query(CorrectionPart).filter_by(package_id=package.id).order_by(CorrectionPart.id).all()
        assert [(part.scope, part.description, part.assignee_user_id, part.state) for part in parts] == [
            ("text", "Уточнить финальную формулировку", text_assignee_id, "pending"),
            ("video", "Сократить синхрон", video_assignee_id, "pending"),
            ("titles", "Исправить подпись", titles_assignee_id, "pending"),
        ]
        production = db.get(StoryProductionState, story_id)
        workflow = db.get(StoryWorkflowState, story_id)
        assert production.video_ready_at is None
        assert production.video_approved_for_titles_at is None
        assert production.titles_ready_at is None
        assert production.titles_accepted_at is None
        assert production.voiceover_ready is True
        assert workflow.editorial_revision == 0
        assert workflow.proofread_revision == 0
        event = db.query(StoryEvent).filter_by(story_id=story_id).order_by(StoryEvent.id.desc()).first()
        assert event.event_code == "external_approval_changes_requested"
        assert event.payload["cycle_id"] == cycle_id
        assert event.payload["package_id"] == package.id
        assert db.query(Notification).filter_by(story_id=story_id).count() >= 3
        assert response.json()["resource"] == {
            "type": "correction_package",
            "id": package.id,
        }


@pytest.mark.parametrize(
    ("part", "expected_code"),
    [
        (
            {"scope": "unknown", "description": "Ошибка области", "assignee_user_id": 1},
            "CORRECTION_SCOPE_INVALID",
        ),
        (
            {"scope": "text", "description": "Ошибка назначения", "assignee_user_id": 999999},
            "ASSIGNEE_INVALID",
        ),
    ],
)
def test_invalid_external_part_rolls_back_every_related_state(client, part, expected_code) -> None:
    with SessionLocal() as db:
        story_id = _story(db).id
        if part["assignee_user_id"] == 1:
            part["assignee_user_id"] = _user(db, "lira").id
    cycle_id = _send(client, story_id).json()["resource"]["id"]

    with SessionLocal() as db:
        before = {
            "packages": db.query(CorrectionPackage).filter_by(story_id=story_id).count(),
            "parts": db.query(CorrectionPart).join(CorrectionPackage).filter(CorrectionPackage.story_id == story_id).count(),
            "events": db.query(StoryEvent).filter_by(story_id=story_id).count(),
            "notifications": db.query(Notification).filter_by(story_id=story_id).count(),
            "production": tuple(
                getattr(db.get(StoryProductionState, story_id), name)
                for name in (
                    "voiceover_ready",
                    "video_ready_at",
                    "video_approved_for_titles_at",
                    "titles_ready_at",
                    "titles_accepted_at",
                )
            ),
            "workflow": tuple(
                getattr(db.get(StoryWorkflowState, story_id), name)
                for name in ("editorial_revision", "proofread_revision", "changed_after_proofread")
            ),
        }

    response = _result(
        client,
        story_id,
        cycle_id,
        {"result": "changes_requested", "parts": [part]},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == expected_code

    with SessionLocal() as db:
        cycle = db.get(ExternalApprovalCycle, cycle_id)
        after = {
            "packages": db.query(CorrectionPackage).filter_by(story_id=story_id).count(),
            "parts": db.query(CorrectionPart).join(CorrectionPackage).filter(CorrectionPackage.story_id == story_id).count(),
            "events": db.query(StoryEvent).filter_by(story_id=story_id).count(),
            "notifications": db.query(Notification).filter_by(story_id=story_id).count(),
            "production": tuple(
                getattr(db.get(StoryProductionState, story_id), name)
                for name in (
                    "voiceover_ready",
                    "video_ready_at",
                    "video_approved_for_titles_at",
                    "titles_ready_at",
                    "titles_accepted_at",
                )
            ),
            "workflow": tuple(
                getattr(db.get(StoryWorkflowState, story_id), name)
                for name in ("editorial_revision", "proofread_revision", "changed_after_proofread")
            ),
        }
        assert after == before
        assert cycle.result == "pending"
        assert cycle.correction_package_id is None


def test_invalid_external_assignee_is_rejected_before_any_package_or_part_insert(client) -> None:
    with SessionLocal() as db:
        story_id = _story(db).id
    cycle_id = _send(client, story_id).json()["resource"]["id"]
    statements: list[str] = []

    def capture(_connection, _cursor, statement, _parameters, _context, _executemany):
        statements.append(statement.lower())

    event.listen(engine, "before_cursor_execute", capture)
    try:
        response = _result(
            client,
            story_id,
            cycle_id,
            {
                "result": "changes_requested",
                "parts": [
                    {
                        "scope": "text",
                        "description": "Недоступный исполнитель",
                        "assignee_user_id": 999999,
                    }
                ],
            },
        )
    finally:
        event.remove(engine, "before_cursor_execute", capture)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "ASSIGNEE_INVALID"
    assert not any("insert into correction_packages" in statement for statement in statements)
    assert not any("insert into correction_parts" in statement for statement in statements)


def test_external_package_completion_close_and_second_cycle_use_existing_workflow(client) -> None:
    with SessionLocal() as db:
        story_id = _story(db).id
        lira_id = _user(db, "lira").id
        mayak_id = _user(db, "mayak").id
    cycle_id = _send(client, story_id).json()["resource"]["id"]
    changed = _result(
        client,
        story_id,
        cycle_id,
        {
            "result": "changes_requested",
            "parts": [
                {"scope": "text", "description": "Правка текста", "assignee_user_id": lira_id},
                {"scope": "voiceover", "description": "Правка звука", "assignee_user_id": mayak_id},
            ],
        },
    )
    assert changed.status_code == 200, changed.text
    with SessionLocal() as db:
        package_id = db.get(ExternalApprovalCycle, cycle_id).correction_package_id
        parts = db.query(CorrectionPart).filter_by(package_id=package_id).order_by(CorrectionPart.id).all()
        part_ids = [(part.id, part.assignee_user_id) for part in parts]

    for part_id, assignee_id in part_ids:
        username = "lira" if assignee_id == lira_id else "mayak"
        completed = client.post(
            f"/api/v1/stories/{story_id}/correction-packages/{package_id}/parts/{part_id}/complete",
            json={"completion_action": "none"},
            cookies=_login(client, username),
        )
        assert completed.status_code == 200, completed.text

    closed = client.post(
        f"/api/v1/stories/{story_id}/correction-packages/{package_id}/close",
        json={},
        cookies=_login(client, "astra"),
    )
    assert closed.status_code == 200, closed.text
    second = _send(client, story_id)
    assert second.status_code == 200, second.text
    with SessionLocal() as db:
        cycles = db.query(ExternalApprovalCycle).filter_by(story_id=story_id).order_by(ExternalApprovalCycle.cycle_no).all()
        assert [(cycle.cycle_no, cycle.result) for cycle in cycles] == [
            (1, "changes_requested"),
            (2, "pending"),
        ]
        assert db.query(CorrectionPackage).filter_by(story_id=story_id).count() == 1


def test_archived_story_rejects_external_mutations(client) -> None:
    with SessionLocal() as db:
        archived = db.query(Story).filter(Story.archived_at.is_not(None)).first()
        story_id = archived.id

    response = _send(client, story_id)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "STORY_ARCHIVED"


def test_pending_result_and_resend_are_stable_deduped_leadership_personal_actions(client) -> None:
    with SessionLocal() as db:
        story_id = _story(db).id
        assignee_id = _user(db, "lira").id
        chief_id = _user(db, "astra").id
        for unrelated in db.query(Story).filter(Story.id != story_id, Story.archived_at.is_(None)):
            unrelated.aired_at = datetime.now(UTC)
            unrelated.aired_by_user_id = chief_id
            unrelated.archived_at = datetime.now(UTC)
            unrelated.archived_by_user_id = chief_id
        db.commit()

    cycle_id = _send(client, story_id).json()["resource"]["id"]
    pending = client.get("/api/v1/me/actions?limit=100", cookies=_login(client, "astra")).json()
    pending_items = [item for item in pending["items"] if item["id"].startswith(f"story:{story_id}:external:")]
    assert len(pending_items) == 1
    assert pending_items[0]["id"] == f"story:{story_id}:external:cycle:{cycle_id}:result"
    assert pending_items[0]["target_href"] == f"/stories/{story_id}/production?action=external-approval"
    assert pending_items[0]["action"]["href"] == _url(story_id)
    assert pending_items[0]["action"]["method"] == "GET"
    assert pending_items[0]["action"]["form"] is None

    _result(
        client,
        story_id,
        cycle_id,
        {
            "result": "changes_requested",
            "parts": [{"scope": "text", "description": "Исправить текст", "assignee_user_id": assignee_id}],
        },
    )
    with SessionLocal() as db:
        package_id = db.get(ExternalApprovalCycle, cycle_id).correction_package_id
        part_id = db.query(CorrectionPart).filter_by(package_id=package_id).one().id
    assert client.post(
        f"/api/v1/stories/{story_id}/correction-packages/{package_id}/parts/{part_id}/complete",
        json={"completion_action": "none"},
        cookies=_login(client, "lira"),
    ).status_code == 200
    assert client.post(
        f"/api/v1/stories/{story_id}/correction-packages/{package_id}/close",
        json={},
        cookies=_login(client, "astra"),
    ).status_code == 200

    resend = client.get("/api/v1/me/actions?limit=100", cookies=_login(client, "astra")).json()
    resend_items = [item for item in resend["items"] if item["id"].startswith(f"story:{story_id}:external:")]
    assert len(resend_items) == 1
    assert resend_items[0]["id"] == f"story:{story_id}:external:resend"
    assert resend_items[0]["target_href"] == f"/stories/{story_id}/production?action=external-approval"
    assert resend_items[0]["action"]["href"] == f"{_url(story_id)}/send"
