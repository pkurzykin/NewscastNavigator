from __future__ import annotations

from typing import Any

from sqlalchemy import select

from app.core.security import create_session_token, hash_password
from app.db.models import Rubric, Scenario, Story, User, UserFunction
from app.db.session import SessionLocal


def _create_editor_story() -> tuple[int, int]:
    with SessionLocal() as db:
        author = User(
            username="editor-bridge-author",
            display_name="Астра",
            position="Автор",
            password_hash=hash_password("Editor-Bridge-2026!"),
            is_active=True,
            must_change_password=False,
            functions=[UserFunction(function_code="author")],
        )
        rubric = Rubric(name="Учебная рубрика", is_active=True)
        db.add_all([author, rubric])
        db.flush()
        story = Story(
            title="Синтетический редакторский сюжет",
            rubric_id=rubric.id,
            author_user_id=author.id,
        )
        db.add(story)
        db.flush()
        db.add(Scenario(story_id=story.id))
        db.commit()
        return story.id, author.id


def _login(client) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": "editor-bridge-author", "password": "Editor-Bridge-2026!"},
    )
    assert response.status_code == 200, response.text


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
        "order_index": order_index,
        "block_type": block_type,
        "text": text,
        "speaker_text": speaker_text,
        "file_name": "synthetic-master.mov",
        "tc_in": "00:01",
        "tc_out": "00:08",
        "additional_comment": "Синтетическая заметка",
        "structured_data": structured_data or {},
        "formatting": formatting or {},
        "rich_text": rich_text or {},
    }


def test_story_editor_bridge_preserves_rows_and_cookie_only_authentication(client) -> None:
    story_id, author_id = _create_editor_story()

    bearer_only = client.get(
        f"/api/v1/stories/{story_id}/editor",
        headers={"Authorization": f"Bearer {create_session_token(author_id)}"},
    )
    assert bearer_only.status_code == 401

    _login(client)
    rows = [
        _row(
            1,
            "podvodka",
            "Ведущий открывает синтетический выпуск",
            formatting={"targets": {"text": {"bold": True}}},
            rich_text={
                "schema_version": 1,
                "targets": {
                    "text": {
                        "editor": "tiptap",
                        "text": "Ведущий открывает синтетический выпуск",
                        "html": "<strong>Ведущий</strong> открывает синтетический выпуск",
                    }
                },
            },
        ),
        _row(
            2,
            "zk_geo",
            "Первая строка географического блока\nВторая строка",
            structured_data={
                "geo": "Тестоград",
                "text_lines": ["Первая строка географического блока", "Вторая строка"],
            },
        ),
        _row(3, "life", "Синтетический интершум"),
        _row(
            4,
            "snh",
            "Синтетическая реплика",
            speaker_text="Тестов Тест\nЭксперт лаборатории",
        ),
    ]

    saved = client.put(
        f"/api/v1/stories/{story_id}/editor",
        json={"rows": rows},
    )
    assert saved.status_code == 200, saved.text
    payload = saved.json()
    assert payload["story"]["id"] == story_id
    assert [item["block_type"] for item in payload["elements"]] == [
        "podvodka",
        "zk_geo",
        "life",
        "snh",
    ]
    assert all(item["segment_uid"].startswith("seg_") for item in payload["elements"])
    assert payload["elements"][0]["formatting"]["targets"]["text"]["bold"] is True
    assert (
        payload["elements"][0]["rich_text"]["targets"]["text"]["html"]
        == "<strong>Ведущий</strong> открывает синтетический выпуск"
    )
    assert payload["elements"][1]["structured_data"]["geo"] == "Тестоград"
    assert payload["elements"][3]["speaker_text"] == "Тестов Тест\nЭксперт лаборатории"

    original = payload["elements"]
    duplicate = dict(original[1])
    duplicate.pop("id")
    duplicate.pop("segment_uid")
    duplicate["text"] = "Дубликат географического блока"
    duplicate["structured_data"] = {
        "geo": "Тестоград",
        "text_lines": ["Дубликат географического блока"],
    }
    reordered = [dict(original[3]), duplicate, dict(original[0])]
    saved_again = client.put(
        f"/api/v1/stories/{story_id}/editor",
        json={"rows": reordered},
    )
    assert saved_again.status_code == 200, saved_again.text
    persisted = saved_again.json()["elements"]
    assert [item["text"] for item in persisted] == [
        "Синтетическая реплика",
        "Дубликат географического блока",
        "Ведущий открывает синтетический выпуск",
    ]
    assert persisted[0]["id"] == original[3]["id"]
    assert persisted[0]["segment_uid"] == original[3]["segment_uid"]
    assert persisted[2]["id"] == original[0]["id"]
    assert persisted[2]["segment_uid"] == original[0]["segment_uid"]
    assert persisted[1]["segment_uid"] not in {item["segment_uid"] for item in original}
    assert original[1]["segment_uid"] not in {item["segment_uid"] for item in persisted}

    with SessionLocal() as db:
        scenario = db.scalar(select(Scenario).where(Scenario.story_id == story_id))
        assert scenario is not None
        assert scenario.revision_no == 0
