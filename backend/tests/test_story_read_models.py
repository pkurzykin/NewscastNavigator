from __future__ import annotations

from app.services.story_queries import build_story_list_read_model


def test_story_list_read_model_uses_product_reset_contract() -> None:
    payload = build_story_list_read_model(
        story_id=7,
        title="Учебный сюжет",
        priority="high",
        rubric={"id": 2, "name": "Новости"},
        author={"id": 3, "username": "lira", "display_name": "Лира", "position": "Корреспондент", "function_codes": ["author"]},
        created_at="2026-07-12T10:00:00+00:00",
        updated_at="2026-07-12T10:05:00+00:00",
        archived_at=None,
        assignments=[],
    )

    assert payload == {
        "id": 7,
        "title": "Учебный сюжет",
        "priority": {"code": "high", "label": "Высокий"},
        "rubric": {"id": 2, "name": "Новости"},
        "author": {"id": 3, "username": "lira", "display_name": "Лира", "position": "Корреспондент", "function_codes": ["author"]},
        "situation": {"code": "active", "label": "В работе"},
        "assignments": [],
        "created_at": "2026-07-12T10:00:00+00:00",
        "updated_at": "2026-07-12T10:05:00+00:00",
        "aired_at": None,
        "archived_at": None,
        "lifecycle_actions": [],
        "management": None,
    }


def test_story_list_read_model_labels_standard_priority_exactly() -> None:
    payload = build_story_list_read_model(
        story_id=8,
        title="Учебный сюжет со стандартным приоритетом",
        priority="standard",
        rubric={"id": 2, "name": "Новости"},
        author={"id": 3, "username": "lira", "display_name": "Лира", "position": "Корреспондент", "function_codes": ["author"]},
        created_at="2026-07-12T10:00:00+00:00",
        updated_at="2026-07-12T10:00:00+00:00",
        archived_at=None,
        assignments=[],
    )

    assert payload["priority"] == {"code": "standard", "label": "Стандарт"}
