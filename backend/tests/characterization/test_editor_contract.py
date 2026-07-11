from __future__ import annotations

from typing import Any


def _login(client) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "admin123"},
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _create_synthetic_project(client, headers: dict[str, str]) -> dict[str, Any]:
    response = client.post(
        "/api/v1/projects",
        json={
            "creation_mode": "story",
            "title": "Синтетический сценарий",
            "rubric": "Тестовая рубрика",
        },
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()["project"]


def _formatting(*, bold: bool = False, italic: bool = False) -> dict[str, Any]:
    return {
        "targets": {
            "text": {
                "font_family": "PT Sans",
                "bold": bold,
                "italic": italic,
                "strikethrough": False,
                "fill_color": "#ffffff",
            }
        }
    }


def _row(
    order_index: int,
    block_type: str,
    text: str,
    *,
    speaker_text: str = "",
    structured_data: dict[str, Any] | None = None,
    file_name: str = "",
    tc_in: str = "",
    tc_out: str = "",
    additional_comment: str = "",
    formatting: dict[str, Any] | None = None,
    rich_text: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "order_index": order_index,
        "block_type": block_type,
        "text": text,
        "speaker_text": speaker_text,
        "file_name": file_name,
        "tc_in": tc_in,
        "tc_out": tc_out,
        "additional_comment": additional_comment,
        "structured_data": structured_data or {},
        "formatting": formatting or {},
        "rich_text": rich_text or {},
    }


def test_editor_api_round_trips_all_current_block_types_and_structured_fields(client) -> None:
    headers = _login(client)
    project = _create_synthetic_project(client, headers)
    rows = [
        _row(
            1,
            "podvodka",
            "Ведущий открывает синтетический выпуск",
            formatting=_formatting(bold=True),
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
            "zk",
            "Закадровый текст",
            file_name="synthetic-master.mov",
            tc_in="00:01",
            tc_out="00:08",
            additional_comment="Синтетический общий план",
        ),
        _row(
            3,
            "zk_geo",
            "Первая строка географического блока\nВторая строка",
            structured_data={
                "geo": "Тестоград",
                "text_lines": ["Первая строка географического блока", "Вторая строка"],
                "file_bundles": [
                    {
                        "file_name": "synthetic-geo.mov",
                        "tc_in": "00:09",
                        "tc_out": "00:17",
                    }
                ],
            },
        ),
        _row(
            4,
            "life",
            "Синтетический интершум",
            file_name="synthetic-life.mov",
            tc_in="00:18",
            tc_out="00:24",
            formatting=_formatting(italic=True),
        ),
        _row(
            5,
            "snh",
            "Синтетическая реплика",
            speaker_text="Тестов Тест\nЭксперт лаборатории",
            file_name="synthetic-sync.mov",
            tc_in="00:25",
            tc_out="00:33",
        ),
    ]

    save_response = client.put(
        f"/api/v1/projects/{project['id']}/editor",
        json={"rows": rows},
        headers=headers,
    )
    assert save_response.status_code == 200, save_response.text

    load_response = client.get(
        f"/api/v1/projects/{project['id']}/editor",
        headers=headers,
    )
    assert load_response.status_code == 200, load_response.text
    persisted = load_response.json()["elements"]

    assert [item["block_type"] for item in persisted] == [
        "podvodka",
        "zk",
        "zk_geo",
        "life",
        "snh",
    ]
    assert [item["order_index"] for item in persisted] == [1, 2, 3, 4, 5]
    assert all(item["segment_uid"].startswith("seg_") for item in persisted)
    assert len({item["segment_uid"] for item in persisted}) == 5

    assert persisted[0]["formatting"]["targets"]["text"]["bold"] is True
    assert (
        persisted[0]["rich_text"]["targets"]["text"]["html"]
        == "<strong>Ведущий</strong> открывает синтетический выпуск"
    )
    assert persisted[1]["file_name"] == "synthetic-master.mov"
    assert (persisted[1]["tc_in"], persisted[1]["tc_out"]) == ("00:01", "00:08")
    assert persisted[2]["structured_data"]["geo"] == "Тестоград"
    assert persisted[2]["structured_data"]["text_lines"] == [
        "Первая строка географического блока",
        "Вторая строка",
    ]
    assert persisted[2]["structured_data"]["file_bundles"] == [
        {
            "file_name": "synthetic-geo.mov",
            "tc_in": "00:09",
            "tc_out": "00:17",
        }
    ]
    assert persisted[4]["speaker_text"] == "Тестов Тест\nЭксперт лаборатории"
    assert persisted[4]["rich_text"]["targets"]["speaker_fio"]["text"] == "Тестов Тест"
    assert (
        persisted[4]["rich_text"]["targets"]["speaker_position"]["text"]
        == "Эксперт лаборатории"
    )


def test_editor_api_preserves_stable_ids_across_reorder_duplicate_and_delete(client) -> None:
    headers = _login(client)
    project = _create_synthetic_project(client, headers)
    first_save = client.put(
        f"/api/v1/projects/{project['id']}/editor",
        json={
            "rows": [
                _row(1, "podvodka", "Первая строка"),
                _row(2, "zk", "Вторая строка"),
                _row(3, "life", "Удаляемая строка"),
            ]
        },
        headers=headers,
    )
    assert first_save.status_code == 200, first_save.text
    original = first_save.json()["elements"]

    duplicate = dict(original[1])
    duplicate.pop("id")
    duplicate.pop("segment_uid")
    duplicate["text"] = "Дубликат второй строки"
    reordered_rows = [dict(original[1]), duplicate, dict(original[0])]

    second_save = client.put(
        f"/api/v1/projects/{project['id']}/editor",
        json={"rows": reordered_rows},
        headers=headers,
    )
    assert second_save.status_code == 200, second_save.text
    load_response = client.get(
        f"/api/v1/projects/{project['id']}/editor",
        headers=headers,
    )
    assert load_response.status_code == 200, load_response.text
    persisted = load_response.json()["elements"]

    assert [item["text"] for item in persisted] == [
        "Вторая строка",
        "Дубликат второй строки",
        "Первая строка",
    ]
    assert [item["order_index"] for item in persisted] == [1, 2, 3]
    assert persisted[0]["id"] == original[1]["id"]
    assert persisted[0]["segment_uid"] == original[1]["segment_uid"]
    assert persisted[2]["id"] == original[0]["id"]
    assert persisted[2]["segment_uid"] == original[0]["segment_uid"]
    assert persisted[1]["segment_uid"] not in {item["segment_uid"] for item in original}
    assert original[2]["segment_uid"] not in {item["segment_uid"] for item in persisted}
