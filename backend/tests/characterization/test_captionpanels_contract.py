from __future__ import annotations

from typing import Any


def _login(client) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "admin123"},
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _create_project(client, headers: dict[str, str]) -> dict[str, Any]:
    response = client.post(
        "/api/v1/projects",
        json={
            "creation_mode": "story",
            "title": "CaptionPanels синтетика",
            "rubric": "Тестовая рубрика",
        },
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()["project"]


def _row(
    order_index: int,
    block_type: str,
    text: str,
    *,
    speaker_text: str = "",
    structured_data: dict[str, Any] | None = None,
    rich_text: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "order_index": order_index,
        "block_type": block_type,
        "text": text,
        "speaker_text": speaker_text,
        "file_name": "",
        "tc_in": "",
        "tc_out": "",
        "additional_comment": "",
        "structured_data": structured_data or {},
        "formatting": {},
        "rich_text": rich_text or {},
    }


def test_captionpanels_maps_current_rows_to_stable_story_segments_and_omits_struck_text(client) -> None:
    headers = _login(client)
    project = _create_project(client, headers)
    rows = [
        _row(1, "podvodka", "Подводка не экспортируется"),
        _row(
            2,
            "zk",
            "Оставить убрать первая",
            rich_text={
                "schema_version": 1,
                "targets": {
                    "text": {
                        "editor": "tiptap",
                        "text": "Оставить убрать первая",
                        "doc": {
                            "type": "doc",
                            "content": [
                                {
                                    "type": "paragraph",
                                    "content": [
                                        {"type": "text", "text": "Оставить "},
                                        {
                                            "type": "text",
                                            "text": "убрать ",
                                            "marks": [{"type": "strike"}],
                                        },
                                        {"type": "text", "text": "первая"},
                                    ],
                                }
                            ],
                        },
                    }
                },
            },
        ),
        _row(3, "zk", "Вторая строка"),
        _row(
            4,
            "zk_geo",
            "Текст после гео",
            structured_data={"geo": "Тестоград", "text_lines": ["Текст после гео"]},
        ),
        _row(
            5,
            "snh",
            "Реплика эксперта",
            speaker_text="Тестов Тест\nЭксперт лаборатории",
        ),
        _row(6, "life", "Синтетический интершум"),
    ]
    save_response = client.put(
        f"/api/v1/projects/{project['id']}/editor",
        json={"rows": rows},
        headers=headers,
    )
    assert save_response.status_code == 200, save_response.text
    saved = save_response.json()["elements"]

    choices_response = client.get(
        "/api/v1/integrations/captionpanels/projects",
        headers=headers,
    )
    assert choices_response.status_code == 200, choices_response.text
    choice = next(item for item in choices_response.json()["items"] if item["projectId"] == project["id"])
    assert choice["storyUid"] == f"story_{project['id']}"
    assert choice["segmentCount"] == 6
    assert choice["syncSegmentCount"] == 2

    import_response = client.get(
        f"/api/v1/integrations/captionpanels/projects/{project['id']}/import-json",
        headers=headers,
    )
    assert import_response.status_code == 200, import_response.text
    payload = import_response.json()

    assert payload["meta"] == {
        "title": "CaptionPanels синтетика",
        "rubric": "Тестовая рубрика",
    }
    assert payload["speakers"] == [
        {
            "id": payload["segments"][3]["speakerId"],
            "name": "Тестов Тест",
            "job": "Эксперт лаборатории",
        }
    ]
    assert payload["segments"] == [
        {
            "id": saved[1]["segment_uid"],
            "type": "voiceover",
            "text": "Оставить первая\nВторая строка",
        },
        {
            "id": f"{saved[3]['segment_uid']}:geo",
            "type": "geotag",
            "text": "Тестоград",
        },
        {
            "id": saved[3]["segment_uid"],
            "type": "voiceover",
            "text": "Текст после гео",
        },
        {
            "id": saved[4]["segment_uid"],
            "type": "synch",
            "text": "Реплика эксперта",
            "speakerId": payload["speakers"][0]["id"],
        },
        {
            "id": saved[5]["segment_uid"],
            "type": "life",
            "text": "Синтетический интершум",
        },
    ]

    repeated = client.get(
        f"/api/v1/integrations/captionpanels/projects/{project['id']}/import-json",
        headers=headers,
    )
    assert repeated.status_code == 200, repeated.text
    assert repeated.json() == payload
