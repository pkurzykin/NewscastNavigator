from __future__ import annotations

from typing import Any

from sqlalchemy import select

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
        author = User(
            username="character-editor",
            display_name="Астра",
            position="Автор",
            password_hash=hash_password("Character-Editor-2026!"),
            is_active=True,
            must_change_password=False,
            functions=[UserFunction(function_code="author")],
        )
        rubric = Rubric(name="Тестовая рубрика", is_active=True)
        db.add_all([author, rubric])
        db.flush()
        story = Story(title="Синтетический сценарий", rubric_id=rubric.id, author_user_id=author.id)
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
    response = client.post(
        "/api/v1/auth/login",
        json={"username": "character-editor", "password": "Character-Editor-2026!"},
    )
    assert response.status_code == 200, response.text


def _formatting(*, bold: bool = False, italic: bool = False) -> dict[str, Any]:
    return {"targets": {"text": {"font_family": "PT Sans", "bold": bold, "italic": italic, "strikethrough": False, "fill_color": "#ffffff"}}}


def _row(
    order_index: int,
    block_type: str,
    text: str,
    *,
    speaker_text: str = "",
    structured_data: dict[str, Any] | None = None,
    formatting: dict[str, Any] | None = None,
    rich_text: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "segment_uid": f"seg_00000000-0000-4000-8000-{order_index:012d}",
        "order_index": order_index,
        "block_type": block_type,
        "text": text,
        "speaker_text": speaker_text,
        "file_name": "synthetic-master.mov",
        "tc_in": "00:01",
        "tc_out": "00:08",
        "additional_comment": "Синтетический общий план",
        "structured_data": structured_data or {},
        "formatting": formatting or {},
        "rich_text": rich_text or {},
    }


def _save(client, story_id: int, rows: list[dict[str, Any]], revision: int = 0) -> dict[str, Any]:
    lease = client.post(f"/api/v1/stories/{story_id}/scenario/lease", json={})
    assert lease.status_code == 200, lease.text
    payload = lease.json()
    response = client.put(f"/api/v1/stories/{story_id}/scenario", json={"base_revision": revision, "client_save_id": f"save_{revision + 1:08d}", "edit_session_id": payload["edit_session_id"], "lease_token": payload["lease_token"], "rows": rows})
    assert response.status_code == 200, response.text
    client.request("DELETE", f"/api/v1/stories/{story_id}/scenario/lease", json={"edit_session_id": payload["edit_session_id"], "lease_token": payload["lease_token"]})
    return response.json()


def test_editor_api_round_trips_all_current_block_types_and_structured_fields(client) -> None:
    story_id = _create_story()
    _login(client)
    rows = [
        _row(1, "podvodka", "Ведущий открывает синтетический выпуск", formatting=_formatting(bold=True), rich_text={"schema_version": 1, "targets": {"text": {"editor": "tiptap", "text": "Ведущий открывает синтетический выпуск", "html": "<strong>Ведущий</strong> открывает синтетический выпуск"}}}),
        _row(2, "zk", "Закадровый текст"),
        _row(3, "zk_geo", "Первая строка географического блока\nВторая строка", structured_data={"geo": "Тестоград", "text_lines": ["Первая строка географического блока", "Вторая строка"], "file_bundles": [{"file_name": "synthetic-geo.mov", "tc_in": "00:09", "tc_out": "00:17"}]}),
        _row(4, "life", "Синтетический интершум", formatting=_formatting(italic=True)),
        _row(5, "snh", "Синтетическая реплика", speaker_text="Тестов Тест\nЭксперт лаборатории"),
    ]
    _save(client, story_id, rows)
    load_response = client.get(f"/api/v1/stories/{story_id}/scenario")
    assert load_response.status_code == 200, load_response.text
    persisted = load_response.json()["scenario"]["rows"]
    assert [item["block_type"] for item in persisted] == ["podvodka", "zk", "zk_geo", "life", "snh"]
    assert [item["order_index"] for item in persisted] == [1, 2, 3, 4, 5]
    assert all(item["segment_uid"].startswith("seg_") for item in persisted)
    assert len({item["segment_uid"] for item in persisted}) == 5
    assert persisted[0]["formatting"]["targets"]["text"]["bold"] is True
    assert persisted[0]["rich_text"]["targets"]["text"]["html"] == "<strong>Ведущий</strong> открывает синтетический выпуск"
    assert (persisted[1]["tc_in"], persisted[1]["tc_out"]) == ("00:01", "00:08")
    assert persisted[2]["structured_data"]["geo"] == "Тестоград"
    assert persisted[2]["structured_data"]["text_lines"] == ["Первая строка географического блока", "Вторая строка"]
    assert persisted[4]["speaker_text"] == "Тестов Тест\nЭксперт лаборатории"
    assert persisted[4]["rich_text"] == {}


def test_editor_api_preserves_stable_ids_across_reorder_duplicate_and_delete(client) -> None:
    story_id = _create_story()
    _login(client)
    initial_rows = [_row(1, "podvodka", "Первая строка"), _row(2, "zk", "Вторая строка"), _row(3, "life", "Удаляемая строка")]
    _save(client, story_id, initial_rows)
    original = client.get(f"/api/v1/stories/{story_id}/scenario").json()["scenario"]["rows"]
    duplicate = dict(original[1])
    duplicate["segment_uid"] = "seg_00000000-0000-4000-8000-000000000099"
    duplicate["text"] = "Дубликат второй строки"
    reordered = [dict(original[1]), duplicate, dict(original[0])]
    for index, row in enumerate(reordered, start=1):
        row["order_index"] = index
    _save(client, story_id, reordered, revision=1)
    persisted = client.get(f"/api/v1/stories/{story_id}/scenario").json()["scenario"]["rows"]
    assert [item["text"] for item in persisted] == ["Вторая строка", "Дубликат второй строки", "Первая строка"]
    assert [item["order_index"] for item in persisted] == [1, 2, 3]
    assert persisted[0]["segment_uid"] == original[1]["segment_uid"]
    assert persisted[2]["segment_uid"] == original[0]["segment_uid"]
    assert persisted[1]["segment_uid"] not in {item["segment_uid"] for item in original}
    assert original[2]["segment_uid"] not in {item["segment_uid"] for item in persisted}
