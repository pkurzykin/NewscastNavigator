from __future__ import annotations

from collections.abc import Iterable


def login(client, username: str, password: str) -> tuple[dict[str, str], dict]:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    return {"Authorization": f"Bearer {payload['access_token']}"}, payload["user"]


def list_projects(client, headers: dict[str, str], *, view: str = "main", **params) -> list[dict]:
    response = client.get(
        "/api/v1/projects",
        params={"view": view, **params},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()["items"]


def find_project(items: Iterable[dict], *, status: str | None = None, title: str | None = None) -> dict:
    for item in items:
        if status is not None and item["status"] != status:
            continue
        if title is not None and item["title"] != title:
            continue
        return item
    raise AssertionError(f"Project not found: status={status!r}, title={title!r}")


def test_clone_editor_and_workspace_return_full_project_metadata(client) -> None:
    headers, _user = login(client, "admin", "admin123")
    main_items = list_projects(client, headers)
    source = find_project(main_items, status="draft")

    clone_response = client.post(f"/api/v1/projects/{source['id']}/clone", headers=headers)
    assert clone_response.status_code == 200, clone_response.text
    cloned_project = clone_response.json()["project"]

    assert cloned_project["source_project_id"] == source["id"]
    assert "executor_user_id" in cloned_project
    assert "proofreader_user_id" in cloned_project
    assert cloned_project["status_changed_at"]

    editor_response = client.get(
        f"/api/v1/projects/{cloned_project['id']}/editor",
        headers=headers,
    )
    assert editor_response.status_code == 200, editor_response.text
    editor_payload = editor_response.json()
    assert editor_payload["project"]["source_project_id"] == source["id"]
    assert "executor_username" in editor_payload["project"]
    assert "proofreader_username" in editor_payload["project"]
    assert all(item["segment_uid"].startswith("seg_") for item in editor_payload["elements"])

    workspace_response = client.get(
        f"/api/v1/projects/{cloned_project['id']}/workspace",
        headers=headers,
    )
    assert workspace_response.status_code == 200, workspace_response.text
    workspace_payload = workspace_response.json()
    assert workspace_payload["project"]["source_project_id"] == source["id"]
    assert "executor_username" in workspace_payload["project"]
    assert "proofreader_username" in workspace_payload["project"]


def test_segment_uid_is_stable_on_save_and_regenerated_on_clone(client) -> None:
    headers, _user = login(client, "editor", "editor123")
    source = find_project(list_projects(client, headers), status="draft")

    source_editor_response = client.get(
        f"/api/v1/projects/{source['id']}/editor",
        headers=headers,
    )
    assert source_editor_response.status_code == 200, source_editor_response.text
    source_editor_payload = source_editor_response.json()
    source_rows = source_editor_payload["elements"]
    assert source_rows
    source_segment_uids = [item["segment_uid"] for item in source_rows]
    assert len(set(source_segment_uids)) == len(source_segment_uids)

    updated_rows = [dict(item) for item in source_rows]
    updated_rows[0]["text"] = f"{updated_rows[0]['text']} (updated)"
    save_response = client.put(
        f"/api/v1/projects/{source['id']}/editor",
        json={"rows": updated_rows},
        headers=headers,
    )
    assert save_response.status_code == 200, save_response.text
    saved_rows = save_response.json()["elements"]
    assert [item["segment_uid"] for item in saved_rows] == source_segment_uids

    clone_response = client.post(f"/api/v1/projects/{source['id']}/clone", headers=headers)
    assert clone_response.status_code == 200, clone_response.text
    cloned_project = clone_response.json()["project"]

    cloned_editor_response = client.get(
        f"/api/v1/projects/{cloned_project['id']}/editor",
        headers=headers,
    )
    assert cloned_editor_response.status_code == 200, cloned_editor_response.text
    cloned_rows = cloned_editor_response.json()["elements"]
    cloned_segment_uids = [item["segment_uid"] for item in cloned_rows]
    assert len(set(cloned_segment_uids)) == len(cloned_segment_uids)
    assert set(cloned_segment_uids).isdisjoint(source_segment_uids)


def test_author_blocked_in_proofreading_but_proofreader_can_edit(client) -> None:
    editor_headers, _editor = login(client, "editor", "editor123")
    author_headers, _author = login(client, "author", "author123")
    proofreader_headers, _proofreader = login(client, "proofreader", "proof123")

    project = find_project(list_projects(client, editor_headers), status="draft")

    meta_response = client.put(
        f"/api/v1/projects/{project['id']}/meta",
        json={"status": "in_proofreading"},
        headers=editor_headers,
    )
    assert meta_response.status_code == 200, meta_response.text

    editor_payload = client.get(
        f"/api/v1/projects/{project['id']}/editor",
        headers=author_headers,
    ).json()
    author_rows_response = client.put(
        f"/api/v1/projects/{project['id']}/editor",
        json={"rows": editor_payload["elements"]},
        headers=author_headers,
    )
    assert author_rows_response.status_code == 403, author_rows_response.text
    assert "корректур" in author_rows_response.json()["detail"].lower()

    author_workspace_response = client.put(
        f"/api/v1/projects/{project['id']}/workspace",
        json={"file_root": "author-path", "project_note": "author update"},
        headers=author_headers,
    )
    assert author_workspace_response.status_code == 403, author_workspace_response.text

    proofreader_rows_payload = client.get(
        f"/api/v1/projects/{project['id']}/editor",
        headers=proofreader_headers,
    ).json()
    proofreader_rows_response = client.put(
        f"/api/v1/projects/{project['id']}/editor",
        json={"rows": proofreader_rows_payload["elements"]},
        headers=proofreader_headers,
    )
    assert proofreader_rows_response.status_code == 200, proofreader_rows_response.text

    proofreader_workspace_response = client.put(
        f"/api/v1/projects/{project['id']}/workspace",
        json={"file_root": "proof-path", "project_note": "proof update"},
        headers=proofreader_headers,
    )
    assert proofreader_workspace_response.status_code == 200, proofreader_workspace_response.text


def test_archive_restore_preserves_previous_status_and_archive_filters(client) -> None:
    headers, user = login(client, "editor", "editor123")

    create_response = client.post(
        "/api/v1/projects",
        json={"title": "Archive smoke"},
        headers=headers,
    )
    assert create_response.status_code == 200, create_response.text
    created_project = create_response.json()["project"]

    reviewed_response = client.put(
        f"/api/v1/projects/{created_project['id']}/meta",
        json={"status": "reviewed"},
        headers=headers,
    )
    assert reviewed_response.status_code == 200, reviewed_response.text

    archive_response = client.post(
        f"/api/v1/projects/{created_project['id']}/archive",
        headers=headers,
    )
    assert archive_response.status_code == 200, archive_response.text
    archived_project = archive_response.json()["project"]

    assert archived_project["status"] == "archived"
    assert archived_project["archived_at"]
    assert archived_project["archived_by_user_id"] == user["id"]
    assert archived_project["archived_by_username"] == user["username"]

    archive_items = list_projects(
        client,
        headers,
        view="archive",
        archived_by=user["username"],
        status="archived",
    )
    assert any(item["id"] == created_project["id"] for item in archive_items)

    restore_response = client.post(
        f"/api/v1/projects/{created_project['id']}/restore",
        headers=headers,
    )
    assert restore_response.status_code == 200, restore_response.text
    restored_project = restore_response.json()["project"]
    assert restored_project["status"] == "reviewed"


def test_file_upload_adds_history_event(client) -> None:
    headers, _user = login(client, "editor", "editor123")
    project = find_project(list_projects(client, headers), status="draft")

    upload_response = client.post(
        f"/api/v1/projects/{project['id']}/files/upload",
        headers=headers,
        files={"file": ("notes.txt", b"hello from smoke test", "text/plain")},
    )
    assert upload_response.status_code == 200, upload_response.text
    uploaded_file = upload_response.json()
    assert uploaded_file["original_name"] == "notes.txt"

    history_response = client.get(
        f"/api/v1/projects/{project['id']}/history",
        headers=headers,
    )
    assert history_response.status_code == 200, history_response.text
    history_items = history_response.json()["items"]
    assert any(
        item["event_type"] == "file_uploaded" and item["new_value"] == "notes.txt"
        for item in history_items
    )


def test_snh_requires_fio_and_position_lines(client) -> None:
    headers, _user = login(client, "editor", "editor123")
    project = find_project(list_projects(client, headers), status="draft")

    save_response = client.put(
        f"/api/v1/projects/{project['id']}/editor",
        json={
            "rows": [
                {
                    "order_index": 1,
                    "block_type": "snh",
                    "text": "Текст синхрона",
                    "speaker_text": "Иван Иванов",
                    "file_name": "",
                    "tc_in": "",
                    "tc_out": "",
                    "additional_comment": "",
                }
            ]
        },
        headers=headers,
    )
    assert save_response.status_code == 422, save_response.text
    assert "фио и должность" in save_response.json()["detail"].lower()


def test_placeholder_snh_row_can_be_saved_without_speaker_meta(client) -> None:
    headers, _user = login(client, "editor", "editor123")
    project = find_project(list_projects(client, headers), status="draft")

    save_response = client.put(
        f"/api/v1/projects/{project['id']}/editor",
        json={
            "rows": [
                {
                    "order_index": 1,
                    "block_type": "snh",
                    "text": "СНХ:",
                    "speaker_text": "",
                    "file_name": "",
                    "tc_in": "",
                    "tc_out": "",
                    "additional_comment": "",
                }
            ]
        },
        headers=headers,
    )
    assert save_response.status_code == 200, save_response.text
    payload = save_response.json()
    assert payload["ok"] is True
    assert payload["total"] == 1


def test_zk_geo_row_persists_geo_and_text_lines(client) -> None:
    headers, _user = login(client, "editor", "editor123")
    project = find_project(list_projects(client, headers), status="draft")

    save_response = client.put(
        f"/api/v1/projects/{project['id']}/editor",
        json={
            "rows": [
                {
                    "order_index": 1,
                    "block_type": "zk_geo",
                    "text": "Первая строка\nВторая строка",
                    "speaker_text": "",
                    "file_name": "clip.mov",
                    "tc_in": "00:01",
                    "tc_out": "00:08",
                    "additional_comment": "цех",
                    "structured_data": {
                        "geo": "Уфа",
                        "text_lines": ["Первая строка", "Вторая строка"],
                    },
                    "formatting": {},
                }
            ]
        },
        headers=headers,
    )
    assert save_response.status_code == 200, save_response.text
    payload = save_response.json()
    assert payload["elements"][0]["block_type"] == "zk_geo"
    assert payload["elements"][0]["structured_data"]["geo"] == "Уфа"
    assert payload["elements"][0]["structured_data"]["text_lines"] == [
        "Первая строка",
        "Вторая строка",
    ]

    editor_response = client.get(
        f"/api/v1/projects/{project['id']}/editor",
        headers=headers,
    )
    assert editor_response.status_code == 200, editor_response.text
    editor_payload = editor_response.json()
    assert editor_payload["elements"][0]["structured_data"]["geo"] == "Уфа"


def test_executor_array_and_multiple_workspace_paths_are_persisted(client) -> None:
    editor_headers, editor_user = login(client, "editor", "editor123")
    _proof_headers, proof_user = login(client, "proofreader", "proof123")
    project = find_project(list_projects(client, editor_headers), status="draft")

    meta_response = client.put(
        f"/api/v1/projects/{project['id']}/meta",
        json={"executor_user_ids": [editor_user["id"], proof_user["id"]]},
        headers=editor_headers,
    )
    assert meta_response.status_code == 200, meta_response.text
    meta_payload = meta_response.json()
    assert meta_payload["project"]["executor_user_ids"] == [editor_user["id"], proof_user["id"]]
    assert meta_payload["project"]["executor_user_id"] == editor_user["id"]

    workspace_response = client.put(
        f"/api/v1/projects/{project['id']}/workspace",
        json={
            "file_roots": ["/mnt/media/project", "/srv/archive/project"],
            "project_note": "",
        },
        headers=editor_headers,
    )
    assert workspace_response.status_code == 200, workspace_response.text

    workspace_payload = client.get(
        f"/api/v1/projects/{project['id']}/workspace",
        headers=editor_headers,
    )
    assert workspace_payload.status_code == 200, workspace_payload.text
    payload = workspace_payload.json()
    assert payload["workspace"]["file_roots"] == [
        "/mnt/media/project",
        "/srv/archive/project",
    ]
    assert payload["workspace"]["file_root"] == "/mnt/media/project"


def test_export_endpoints_return_files(client) -> None:
    headers, _user = login(client, "admin", "admin123")
    project = find_project(list_projects(client, headers), status="draft")

    docx_response = client.get(
        f"/api/v1/projects/{project['id']}/export/docx",
        headers=headers,
    )
    assert docx_response.status_code == 200, docx_response.text
    assert docx_response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )

    pdf_response = client.get(
        f"/api/v1/projects/{project['id']}/export/pdf",
        headers=headers,
    )
    assert pdf_response.status_code == 200, pdf_response.text
    assert pdf_response.headers["content-type"].startswith("application/pdf")
