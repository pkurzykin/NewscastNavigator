from __future__ import annotations

from typing import Any

from app.core.security import hash_password
from app.db.models import (
    Rubric,
    Scenario,
    Story,
    StoryProductionState,
    StoryWorkflowState,
    User,
    UserFunction,
)
from app.db.session import SessionLocal


def _create_story() -> int:
    with SessionLocal() as db:
        author = User(username="character-caption", display_name="Астра", position="Автор", password_hash=hash_password("Character-Caption-2026!"), is_active=True, must_change_password=False, functions=[UserFunction(function_code="author")])
        rubric = Rubric(name="Тестовая рубрика", is_active=True)
        db.add_all([author, rubric])
        db.flush()
        story = Story(title="CaptionPanels синтетика", rubric_id=rubric.id, author_user_id=author.id)
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


def _login(client) -> None:
    response = client.post("/api/v1/auth/login", json={"username": "character-caption", "password": "Character-Caption-2026!"})
    assert response.status_code == 200, response.text


def _row(order_index: int, block_type: str, text: str, *, speaker_text: str = "", structured_data: dict[str, Any] | None = None, rich_text: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"segment_uid": f"seg_00000000-0000-4000-8000-{order_index:012d}", "order_index": order_index, "block_type": block_type, "text": text, "speaker_text": speaker_text, "file_name": "", "tc_in": "", "tc_out": "", "additional_comment": "", "structured_data": structured_data or {}, "formatting": {}, "rich_text": rich_text or {}}


def test_captionpanels_maps_current_rows_to_stable_story_segments_and_omits_struck_text(client) -> None:
    story_id = _create_story()
    _login(client)
    rows = [
        _row(1, "podvodka", "Подводка не экспортируется"),
        _row(2, "zk", "Оставить убрать первая", rich_text={"schema_version": 1, "targets": {"text": {"editor": "tiptap", "text": "Оставить убрать первая", "doc": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Оставить "}, {"type": "text", "text": "убрать ", "marks": [{"type": "strike"}]}, {"type": "text", "text": "первая"}]}]}}}}),
        _row(3, "zk", "Вторая строка"),
        _row(4, "zk_geo", "Текст после гео", structured_data={"geo": "Тестоград", "text_lines": ["Текст после гео"]}),
        _row(5, "snh", "Реплика эксперта", speaker_text="Тестов Тест\nЭксперт лаборатории"),
        _row(6, "life", "Синтетический интершум"),
    ]
    lease = client.post(f"/api/v1/stories/{story_id}/scenario/lease", json={})
    assert lease.status_code == 200, lease.text
    lease_payload = lease.json()
    saved_response = client.put(f"/api/v1/stories/{story_id}/scenario", json={"base_revision": 0, "client_save_id": "captionpanels_save_0001", "edit_session_id": lease_payload["edit_session_id"], "lease_token": lease_payload["lease_token"], "rows": rows})
    assert saved_response.status_code == 200, saved_response.text
    saved = client.get(f"/api/v1/stories/{story_id}/scenario").json()["scenario"]["rows"]
    choices_response = client.get("/api/v1/integrations/captionpanels/stories")
    assert choices_response.status_code == 200, choices_response.text
    choice = next(item for item in choices_response.json()["items"] if item["storyId"] == story_id)
    assert choice["storyUid"] == f"story_{story_id}"
    assert choice["segmentCount"] == 6
    assert choice["syncSegmentCount"] == 2
    import_response = client.get(f"/api/v1/integrations/captionpanels/stories/{story_id}/import-json")
    assert import_response.status_code == 200, import_response.text
    payload = import_response.json()
    assert payload["meta"] == {"title": "CaptionPanels синтетика", "rubric": "Тестовая рубрика"}
    assert payload["speakers"] == [{"id": payload["segments"][3]["speakerId"], "name": "Тестов Тест", "job": "Эксперт лаборатории"}]
    assert payload["segments"] == [
        {"id": saved[1]["segment_uid"], "type": "voiceover", "text": "Оставить первая\nВторая строка"},
        {"id": f"{saved[3]['segment_uid']}:geo", "type": "geotag", "text": "Тестоград"},
        {"id": saved[3]["segment_uid"], "type": "voiceover", "text": "Текст после гео"},
        {"id": saved[4]["segment_uid"], "type": "synch", "text": "Реплика эксперта", "speakerId": payload["speakers"][0]["id"]},
        {"id": saved[5]["segment_uid"], "type": "life", "text": "Синтетический интершум"},
    ]
    repeated = client.get(f"/api/v1/integrations/captionpanels/stories/{story_id}/import-json")
    assert repeated.status_code == 200, repeated.text
    assert repeated.json() == payload


def test_installed_captionpanels_client_uses_bearer_and_project_routes(client) -> None:
    story_id = _create_story()
    login_response = client.post(
        "/api/v1/auth/login",
        headers={"Origin": "null"},
        json={"username": "character-caption", "password": "Character-Caption-2026!"},
    )
    assert login_response.status_code == 200, login_response.text
    token = login_response.json()["access_token"]
    headers = {"Origin": "null", "Authorization": f"Bearer {token}"}
    client.cookies.clear()

    me_response = client.get("/api/v1/auth/me", headers=headers)
    assert me_response.status_code == 200, me_response.text

    projects_response = client.get(
        "/api/v1/integrations/captionpanels/projects?limit=100",
        headers=headers,
    )
    assert projects_response.status_code == 200, projects_response.text
    choice = next(
        item for item in projects_response.json()["items"] if item["projectId"] == story_id
    )
    assert choice["storyUid"] == f"story_{story_id}"
    assert choice["title"] == "CaptionPanels синтетика"
    assert choice["rubric"] == "Тестовая рубрика"

    import_response = client.get(
        f"/api/v1/integrations/captionpanels/projects/{story_id}/import-json",
        headers=headers,
    )
    assert import_response.status_code == 200, import_response.text
    assert import_response.json()["meta"] == {
        "title": "CaptionPanels синтетика",
        "rubric": "Тестовая рубрика",
    }
