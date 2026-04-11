from __future__ import annotations

from collections.abc import Iterable
import os
from pathlib import Path

from app.core.security import hash_password
from app.db.models import User
from app.db.session import SessionLocal


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


def list_revisions(client, headers: dict[str, str], project_id: int) -> list[dict]:
    response = client.get(f"/api/v1/projects/{project_id}/revisions", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["items"]


def create_revision(
    client,
    headers: dict[str, str],
    project_id: int,
    *,
    title: str = "",
    comment: str = "",
) -> dict:
    response = client.post(
        f"/api/v1/projects/{project_id}/revisions",
        json={"title": title, "comment": comment},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()["revision"]


def submit_revision(client, headers: dict[str, str], project_id: int, revision_id: str) -> dict:
    response = client.post(
        f"/api/v1/projects/{project_id}/revisions/{revision_id}/submit",
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()["revision"]


def approve_revision(client, headers: dict[str, str], project_id: int, revision_id: str) -> dict:
    response = client.post(
        f"/api/v1/projects/{project_id}/revisions/{revision_id}/approve",
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()["revision"]


def reject_revision(client, headers: dict[str, str], project_id: int, revision_id: str) -> dict:
    response = client.post(
        f"/api/v1/projects/{project_id}/revisions/{revision_id}/reject",
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()["revision"]


def branch_revision(
    client,
    headers: dict[str, str],
    project_id: int,
    revision_id: str,
    *,
    branch_key: str,
    title: str = "",
    comment: str = "",
) -> dict:
    response = client.post(
        f"/api/v1/projects/{project_id}/revisions/{revision_id}/branch",
        json={"branch_key": branch_key, "title": title, "comment": comment},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()["revision"]


def merge_revision_to_main(client, headers: dict[str, str], project_id: int, revision_id: str) -> dict:
    response = client.post(
        f"/api/v1/projects/{project_id}/revisions/{revision_id}/merge-to-main",
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()["revision"]


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
    assert "titles_assignee_user_id" in cloned_project
    assert "edit_assignee_user_id" in cloned_project
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


def test_user_can_change_password(client) -> None:
    headers, _user = login(client, "admin", "admin123")

    response = client.post(
        "/api/v1/auth/change-password",
        json={
            "current_password": "admin123",
            "new_password": "admin-new-strong-123",
        },
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["ok"] is True

    old_login = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "admin123"},
    )
    assert old_login.status_code == 401, old_login.text

    new_login = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "admin-new-strong-123"},
    )
    assert new_login.status_code == 200, new_login.text


def test_temporary_password_requires_change_and_flag_clears_after_update(client) -> None:
    with SessionLocal() as db:
        db.add(
            User(
                username="temp.user",
                full_name="Temp User",
                job_title="Монтажер",
                password_hash=hash_password("TempPass12345"),
                role="montager",
                is_active=True,
                must_change_password=True,
            )
        )
        db.commit()

    login_response = client.post(
        "/api/v1/auth/login",
        json={"username": "temp.user", "password": "TempPass12345"},
    )
    assert login_response.status_code == 200, login_response.text
    payload = login_response.json()
    assert payload["user"]["must_change_password"] is True

    headers = {"Authorization": f"Bearer {payload['access_token']}"}
    me_response = client.get("/api/v1/auth/me", headers=headers)
    assert me_response.status_code == 200, me_response.text
    assert me_response.json()["must_change_password"] is True

    change_response = client.post(
        "/api/v1/auth/change-password",
        json={
            "current_password": "TempPass12345",
            "new_password": "TempPass67890",
        },
        headers=headers,
    )
    assert change_response.status_code == 200, change_response.text

    refreshed_me = client.get("/api/v1/auth/me", headers=headers)
    assert refreshed_me.status_code == 200, refreshed_me.text
    assert refreshed_me.json()["must_change_password"] is False


def test_admin_can_deactivate_user(client) -> None:
    headers, _user = login(client, "admin", "admin123")

    users_response = client.get("/api/v1/users", headers=headers)
    assert users_response.status_code == 200, users_response.text
    author_user = next(item for item in users_response.json()["items"] if item["username"] == "author")

    deactivate_response = client.post(
        f"/api/v1/users/{author_user['id']}/activation",
        json={"is_active": False},
        headers=headers,
    )
    assert deactivate_response.status_code == 200, deactivate_response.text
    assert deactivate_response.json()["user"]["is_active"] is False

    author_login = client.post(
        "/api/v1/auth/login",
        json={"username": "author", "password": "author123"},
    )
    assert author_login.status_code == 401, author_login.text


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
    assert all(item["rich_text"]["schema_version"] == 1 for item in cloned_rows)


def test_project_text_state_tracks_current_checked_and_proofread(client) -> None:
    author_headers, _author = login(client, "author", "author123")
    proofreader_headers, _proofreader = login(client, "proofreader", "proof123")

    create_response = client.post(
        "/api/v1/projects",
        json={"title": "Text state smoke"},
        headers=author_headers,
    )
    assert create_response.status_code == 200, create_response.text
    project = create_response.json()["project"]
    assert project["text_seq"] == 0
    assert project["current_text_seq"] is None

    rows = [
        {
            "order_index": 1,
            "block_type": "zk",
            "text": "Первая версия текста",
            "speaker_text": "",
            "file_name": "",
            "tc_in": "",
            "tc_out": "",
            "additional_comment": "",
            "structured_data": {},
            "formatting": {},
            "rich_text": {},
        }
    ]
    first_save = client.put(
        f"/api/v1/projects/{project['id']}/editor",
        json={"rows": rows},
        headers=author_headers,
    )
    assert first_save.status_code == 200, first_save.text

    editor_payload = client.get(
        f"/api/v1/projects/{project['id']}/editor",
        headers=author_headers,
    ).json()
    project_state = editor_payload["project"]
    saved_rows = editor_payload["elements"]
    assert project_state["text_seq"] == 1
    assert project_state["current_text_seq"] == 1
    assert project_state["current_text_is_latest"] is True
    assert project_state["proofread_text_is_current"] is False

    second_rows = [dict(saved_rows[0])]
    second_rows[0]["text"] = "Вторая версия текста"
    second_save = client.put(
        f"/api/v1/projects/{project['id']}/editor",
        json={"rows": second_rows},
        headers=author_headers,
    )
    assert second_save.status_code == 200, second_save.text

    project_state = client.get(
        f"/api/v1/projects/{project['id']}/editor",
        headers=author_headers,
    ).json()["project"]
    assert project_state["text_seq"] == 2
    assert project_state["current_text_seq"] == 1
    assert project_state["current_text_is_latest"] is False
    assert project_state["latest_text_is_proofread"] is False

    set_current = client.post(
        f"/api/v1/projects/{project['id']}/text/current",
        json={"text_seq": 2},
        headers=author_headers,
    )
    assert set_current.status_code == 200, set_current.text
    assert set_current.json()["project"]["current_text_seq"] == 2
    assert set_current.json()["project"]["current_text_is_latest"] is True

    checked = client.post(
        f"/api/v1/projects/{project['id']}/text/check",
        json={},
        headers=proofreader_headers,
    )
    assert checked.status_code == 200, checked.text
    assert checked.json()["project"]["checked_text_seq"] == 2
    assert checked.json()["project"]["checked_text_is_current"] is True

    proofread = client.post(
        f"/api/v1/projects/{project['id']}/text/proofread",
        json={},
        headers=proofreader_headers,
    )
    assert proofread.status_code == 200, proofread.text
    assert proofread.json()["project"]["proofread_text_seq"] == 2
    assert proofread.json()["project"]["proofread_text_is_current"] is True
    assert proofread.json()["project"]["latest_text_is_proofread"] is True

    current_diff = client.get(
        f"/api/v1/projects/{project['id']}/text/current/diff",
        headers=author_headers,
    )
    assert current_diff.status_code == 200, current_diff.text
    assert current_diff.json()["summary"]["total"] == 0

    proofread_diff = client.get(
        f"/api/v1/projects/{project['id']}/text/proofread/diff",
        headers=proofreader_headers,
    )
    assert proofread_diff.status_code == 200, proofread_diff.text
    assert proofread_diff.json()["summary"]["total"] == 0

    third_rows = [dict(second_rows[0])]
    third_rows[0]["id"] = saved_rows[0]["id"]
    third_rows[0]["segment_uid"] = saved_rows[0]["segment_uid"]
    third_rows[0]["text"] = "Третья версия текста"
    third_save = client.put(
        f"/api/v1/projects/{project['id']}/editor",
        json={"rows": third_rows},
        headers=author_headers,
    )
    assert third_save.status_code == 200, third_save.text

    project_state = client.get(
        f"/api/v1/projects/{project['id']}/editor",
        headers=author_headers,
    ).json()["project"]
    assert project_state["text_seq"] == 3
    assert project_state["current_text_seq"] == 2
    assert project_state["current_text_is_latest"] is False
    assert project_state["proofread_text_seq"] == 2
    assert project_state["proofread_text_is_current"] is True
    assert project_state["latest_text_is_proofread"] is False

    current_diff = client.get(
        f"/api/v1/projects/{project['id']}/text/current/diff",
        headers=author_headers,
    )
    assert current_diff.status_code == 200, current_diff.text
    current_diff_payload = current_diff.json()
    assert current_diff_payload["is_outdated"] is True
    assert current_diff_payload["snapshot_text_seq"] == 2
    assert current_diff_payload["workspace_text_seq"] == 3
    assert current_diff_payload["summary"]["changed"] == 1
    assert current_diff_payload["summary"]["total"] == 1

    proofread_diff = client.get(
        f"/api/v1/projects/{project['id']}/text/proofread/diff",
        headers=proofreader_headers,
    )
    assert proofread_diff.status_code == 200, proofread_diff.text
    proofread_diff_payload = proofread_diff.json()
    assert proofread_diff_payload["is_outdated"] is True
    assert proofread_diff_payload["summary"]["changed"] == 1


def test_project_track_assignees_are_saved_via_meta_update(client) -> None:
    admin_headers, _admin = login(client, "admin", "admin123")
    editor_headers, editor_user = login(client, "editor", "editor123")
    proofreader_headers, proofreader_user = login(client, "proofreader", "proof123")

    create_response = client.post(
        "/api/v1/projects",
        json={"title": "Assignments smoke"},
        headers=admin_headers,
    )
    assert create_response.status_code == 200, create_response.text
    project = create_response.json()["project"]

    meta_response = client.put(
        f"/api/v1/projects/{project['id']}/meta",
        json={
            "author_user_id": editor_user["id"],
            "proofreader_user_id": proofreader_user["id"],
            "titles_assignee_user_id": editor_user["id"],
            "edit_assignee_user_id": editor_user["id"],
        },
        headers=admin_headers,
    )
    assert meta_response.status_code == 200, meta_response.text
    project_payload = meta_response.json()["project"]
    assert project_payload["author_user_id"] == editor_user["id"]
    assert project_payload["proofreader_user_id"] == proofreader_user["id"]
    assert project_payload["titles_assignee_user_id"] == editor_user["id"]
    assert project_payload["edit_assignee_user_id"] == editor_user["id"]

    history_response = client.get(
        f"/api/v1/projects/{project['id']}/history",
        headers=admin_headers,
    )
    assert history_response.status_code == 200, history_response.text
    assignment_events = [
        item for item in history_response.json()["items"] if item["event_type"] == "assignment_changed"
    ]
    changed_fields = {item["meta_json"] for item in assignment_events}
    assert any("titles_assignee_user_id" in (item or "") for item in changed_fields)
    assert any("edit_assignee_user_id" in (item or "") for item in changed_fields)


def test_titles_track_uses_latest_proofread_text_and_detects_resync_need(client) -> None:
    editor_headers, _editor = login(client, "editor", "editor123")
    proofreader_headers, _proofreader = login(client, "proofreader", "proof123")

    create_response = client.post(
        "/api/v1/projects",
        json={"title": "Titles track smoke"},
        headers=editor_headers,
    )
    assert create_response.status_code == 200, create_response.text
    project = create_response.json()["project"]

    rows = [
        {
            "order_index": 1,
            "block_type": "zk",
            "text": "Текст для титров",
            "speaker_text": "",
            "file_name": "",
            "tc_in": "",
            "tc_out": "",
            "additional_comment": "",
            "structured_data": {},
            "formatting": {},
            "rich_text": {},
        }
    ]
    first_save = client.put(
        f"/api/v1/projects/{project['id']}/editor",
        json={"rows": rows},
        headers=editor_headers,
    )
    assert first_save.status_code == 200, first_save.text

    proofread = client.post(
        f"/api/v1/projects/{project['id']}/text/proofread",
        json={"text_seq": 1},
        headers=proofreader_headers,
    )
    assert proofread.status_code == 200, proofread.text

    sync_titles = client.post(
        f"/api/v1/projects/{project['id']}/titles/sync-text",
        json={},
        headers=editor_headers,
    )
    assert sync_titles.status_code == 200, sync_titles.text
    synced_project = sync_titles.json()["project"]
    assert synced_project["titles_status"] == "in_progress"
    assert synced_project["titles_text_seq"] == 1
    assert synced_project["titles_text_is_latest"] is True
    assert synced_project["titles_requires_resync"] is False

    done_response = client.post(
        f"/api/v1/projects/{project['id']}/titles/status",
        json={"status": "done"},
        headers=editor_headers,
    )
    assert done_response.status_code == 200, done_response.text
    assert done_response.json()["project"]["titles_status"] == "done"

    second_rows = [dict(first_save.json()["elements"][0])]
    second_rows[0]["text"] = "Текст для титров с правкой"
    second_save = client.put(
        f"/api/v1/projects/{project['id']}/editor",
        json={"rows": second_rows},
        headers=editor_headers,
    )
    assert second_save.status_code == 200, second_save.text
    stale_project = second_save.json()["project"]
    assert stale_project["text_seq"] == 2
    assert stale_project["titles_text_seq"] == 1
    assert stale_project["titles_text_is_latest"] is False
    assert stale_project["titles_requires_resync"] is True

    sync_without_reproofread = client.post(
        f"/api/v1/projects/{project['id']}/titles/sync-text",
        json={},
        headers=editor_headers,
    )
    assert sync_without_reproofread.status_code == 409, sync_without_reproofread.text

    set_current = client.post(
        f"/api/v1/projects/{project['id']}/text/current",
        json={"text_seq": 2},
        headers=editor_headers,
    )
    assert set_current.status_code == 200, set_current.text
    reproofread = client.post(
        f"/api/v1/projects/{project['id']}/text/proofread",
        json={"text_seq": 2},
        headers=proofreader_headers,
    )
    assert reproofread.status_code == 200, reproofread.text

    resync_titles = client.post(
        f"/api/v1/projects/{project['id']}/titles/sync-text",
        json={},
        headers=editor_headers,
    )
    assert resync_titles.status_code == 200, resync_titles.text
    resynced_project = resync_titles.json()["project"]
    assert resynced_project["titles_text_seq"] == 2
    assert resynced_project["titles_text_is_latest"] is True
    assert resynced_project["titles_text_is_proofread"] is True
    assert resynced_project["titles_requires_resync"] is False


def test_edit_track_uses_current_text_handoff_and_detects_resync_need(client) -> None:
    editor_headers, _editor = login(client, "editor", "editor123")

    create_response = client.post(
        "/api/v1/projects",
        json={"title": "Edit track smoke"},
        headers=editor_headers,
    )
    assert create_response.status_code == 200, create_response.text
    project = create_response.json()["project"]

    rows = [
        {
            "order_index": 1,
            "block_type": "zk",
            "text": "Черновой handoff",
            "speaker_text": "",
            "file_name": "",
            "tc_in": "",
            "tc_out": "",
            "additional_comment": "",
            "structured_data": {},
            "formatting": {},
            "rich_text": {},
        }
    ]
    first_save = client.put(
        f"/api/v1/projects/{project['id']}/editor",
        json={"rows": rows},
        headers=editor_headers,
    )
    assert first_save.status_code == 200, first_save.text

    sync_edit = client.post(
        f"/api/v1/projects/{project['id']}/edit/sync-text",
        json={},
        headers=editor_headers,
    )
    assert sync_edit.status_code == 200, sync_edit.text
    synced_project = sync_edit.json()["project"]
    assert synced_project["edit_status"] == "in_progress"
    assert synced_project["edit_text_seq"] == 1
    assert synced_project["edit_text_is_current"] is True
    assert synced_project["edit_requires_resync"] is False

    review_response = client.post(
        f"/api/v1/projects/{project['id']}/edit/status",
        json={"status": "review"},
        headers=editor_headers,
    )
    assert review_response.status_code == 200, review_response.text
    assert review_response.json()["project"]["edit_status"] == "review"

    second_rows = [dict(first_save.json()["elements"][0])]
    second_rows[0]["text"] = "Новые правки в workspace"
    second_save = client.put(
        f"/api/v1/projects/{project['id']}/editor",
        json={"rows": second_rows},
        headers=editor_headers,
    )
    assert second_save.status_code == 200, second_save.text
    stale_project = second_save.json()["project"]
    assert stale_project["text_seq"] == 2
    assert stale_project["current_text_seq"] == 1
    assert stale_project["edit_text_seq"] == 1
    assert stale_project["edit_requires_resync"] is False

    set_current = client.post(
        f"/api/v1/projects/{project['id']}/text/current",
        json={"text_seq": 2},
        headers=editor_headers,
    )
    assert set_current.status_code == 200, set_current.text
    current_project = set_current.json()["project"]
    assert current_project["current_text_seq"] == 2
    assert current_project["edit_text_seq"] == 1
    assert current_project["edit_requires_resync"] is True

    resync_edit = client.post(
        f"/api/v1/projects/{project['id']}/edit/sync-text",
        json={},
        headers=editor_headers,
    )
    assert resync_edit.status_code == 200, resync_edit.text
    resynced_project = resync_edit.json()["project"]
    assert resynced_project["edit_text_seq"] == 2
    assert resynced_project["edit_text_is_current"] is True
    assert resynced_project["edit_requires_resync"] is False


def test_voiceover_track_uses_latest_proofread_text_and_detects_resync_need(client) -> None:
    editor_headers, _editor = login(client, "editor", "editor123")
    proofreader_headers, _proofreader = login(client, "proofreader", "proof123")

    create_response = client.post(
        "/api/v1/projects",
        json={"title": "Voiceover track smoke"},
        headers=editor_headers,
    )
    assert create_response.status_code == 200, create_response.text
    project = create_response.json()["project"]

    rows = [
        {
            "order_index": 1,
            "block_type": "zk",
            "text": "Текст для озвучки",
            "speaker_text": "",
            "file_name": "",
            "tc_in": "",
            "tc_out": "",
            "additional_comment": "",
            "structured_data": {},
            "formatting": {},
            "rich_text": {},
        }
    ]
    first_save = client.put(
        f"/api/v1/projects/{project['id']}/editor",
        json={"rows": rows},
        headers=editor_headers,
    )
    assert first_save.status_code == 200, first_save.text

    proofread = client.post(
        f"/api/v1/projects/{project['id']}/text/proofread",
        json={"text_seq": 1},
        headers=proofreader_headers,
    )
    assert proofread.status_code == 200, proofread.text

    sync_voiceover = client.post(
        f"/api/v1/projects/{project['id']}/voiceover/sync-text",
        json={},
        headers=editor_headers,
    )
    assert sync_voiceover.status_code == 200, sync_voiceover.text
    synced_project = sync_voiceover.json()["project"]
    assert synced_project["voiceover_status"] == "in_progress"
    assert synced_project["voiceover_text_seq"] == 1
    assert synced_project["voiceover_text_is_latest"] is True
    assert synced_project["voiceover_requires_resync"] is False

    review_response = client.post(
        f"/api/v1/projects/{project['id']}/voiceover/status",
        json={"status": "review"},
        headers=editor_headers,
    )
    assert review_response.status_code == 200, review_response.text
    assert review_response.json()["project"]["voiceover_status"] == "review"

    second_rows = [dict(first_save.json()["elements"][0])]
    second_rows[0]["text"] = "Текст для озвучки с правкой"
    second_save = client.put(
        f"/api/v1/projects/{project['id']}/editor",
        json={"rows": second_rows},
        headers=editor_headers,
    )
    assert second_save.status_code == 200, second_save.text
    stale_project = second_save.json()["project"]
    assert stale_project["text_seq"] == 2
    assert stale_project["voiceover_text_seq"] == 1
    assert stale_project["voiceover_requires_resync"] is True

    sync_without_reproofread = client.post(
        f"/api/v1/projects/{project['id']}/voiceover/sync-text",
        json={},
        headers=editor_headers,
    )
    assert sync_without_reproofread.status_code == 409, sync_without_reproofread.text

    set_current = client.post(
        f"/api/v1/projects/{project['id']}/text/current",
        json={"text_seq": 2},
        headers=editor_headers,
    )
    assert set_current.status_code == 200, set_current.text
    reproofread = client.post(
        f"/api/v1/projects/{project['id']}/text/proofread",
        json={"text_seq": 2},
        headers=proofreader_headers,
    )
    assert reproofread.status_code == 200, reproofread.text

    resync_voiceover = client.post(
        f"/api/v1/projects/{project['id']}/voiceover/sync-text",
        json={},
        headers=editor_headers,
    )
    assert resync_voiceover.status_code == 200, resync_voiceover.text
    resynced_project = resync_voiceover.json()["project"]
    assert resynced_project["voiceover_text_seq"] == 2
    assert resynced_project["voiceover_text_is_latest"] is True
    assert resynced_project["voiceover_text_is_proofread"] is True
    assert resynced_project["voiceover_requires_resync"] is False


def test_final_review_track_updates_submission_status(client) -> None:
    editor_headers, _editor = login(client, "editor", "editor123")

    create_response = client.post(
        "/api/v1/projects",
        json={"title": "Final review smoke"},
        headers=editor_headers,
    )
    assert create_response.status_code == 200, create_response.text
    project = create_response.json()["project"]
    assert project["final_review_status"] == "not_started"

    submitted = client.post(
        f"/api/v1/projects/{project['id']}/final-review/status",
        json={"status": "submitted"},
        headers=editor_headers,
    )
    assert submitted.status_code == 200, submitted.text
    submitted_project = submitted.json()["project"]
    assert submitted_project["final_review_status"] == "submitted"
    assert submitted_project["final_review_updated_at"] is not None

    changes_requested = client.post(
        f"/api/v1/projects/{project['id']}/final-review/status",
        json={"status": "changes_requested"},
        headers=editor_headers,
    )
    assert changes_requested.status_code == 200, changes_requested.text
    assert changes_requested.json()["project"]["final_review_status"] == "changes_requested"

    approved = client.post(
        f"/api/v1/projects/{project['id']}/final-review/status",
        json={"status": "approved"},
        headers=editor_headers,
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["project"]["final_review_status"] == "approved"


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


def test_material_links_crud_and_history(client) -> None:
    headers, _user = login(client, "editor", "editor123")
    project = find_project(list_projects(client, headers), status="draft")

    create_response = client.post(
        f"/api/v1/projects/{project['id']}/material-links",
        headers=headers,
        json={
            "link_type": "source_folder",
            "path": "/mnt/media/project/source",
            "comment": "Исходники для сюжета",
        },
    )
    assert create_response.status_code == 200, create_response.text
    created_link = create_response.json()
    assert created_link["link_type"] == "source_folder"
    assert created_link["path"] == "/mnt/media/project/source"

    workspace_response = client.get(
        f"/api/v1/projects/{project['id']}/workspace",
        headers=headers,
    )
    assert workspace_response.status_code == 200, workspace_response.text
    workspace_payload = workspace_response.json()
    assert any(item["id"] == created_link["id"] for item in workspace_payload["material_links"])

    update_response = client.put(
        f"/api/v1/projects/{project['id']}/material-links/{created_link['id']}",
        headers=headers,
        json={
            "link_type": "master_file",
            "path": "/mnt/media/project/master/final.mov",
            "comment": "Мастер после правок",
        },
    )
    assert update_response.status_code == 200, update_response.text
    updated_link = update_response.json()
    assert updated_link["link_type"] == "master_file"
    assert updated_link["path"] == "/mnt/media/project/master/final.mov"

    delete_response = client.delete(
        f"/api/v1/projects/{project['id']}/material-links/{created_link['id']}",
        headers=headers,
    )
    assert delete_response.status_code == 200, delete_response.text

    history_response = client.get(
        f"/api/v1/projects/{project['id']}/history",
        headers=headers,
    )
    assert history_response.status_code == 200, history_response.text
    history_items = history_response.json()["items"]
    assert any(
        item["event_type"] == "material_link_added"
        and item["new_value"] == "/mnt/media/project/source"
        for item in history_items
    )
    assert any(
        item["event_type"] == "material_link_updated"
        and item["new_value"] == "/mnt/media/project/master/final.mov"
        for item in history_items
    )
    assert any(
        item["event_type"] == "material_link_deleted"
        and item["old_value"] == "/mnt/media/project/master/final.mov"
        for item in history_items
    )


def test_action_comment_lifecycle_updates_history_and_project_counters(client) -> None:
    editor_headers, editor_user = login(client, "editor", "editor123")
    project = find_project(list_projects(client, editor_headers), status="draft")

    meta_response = client.put(
        f"/api/v1/projects/{project['id']}/meta",
        json={"edit_assignee_user_id": editor_user["id"]},
        headers=editor_headers,
    )
    assert meta_response.status_code == 200, meta_response.text

    first_save = client.put(
        f"/api/v1/projects/{project['id']}/editor",
        json={
            "rows": [
                {
                    "order_index": 1,
                    "block_type": "zk",
                    "text": "Первая версия для комментария по монтажу",
                    "speaker_text": "",
                    "file_name": "",
                    "tc_in": "",
                    "tc_out": "",
                    "additional_comment": "",
                }
            ]
        },
        headers=editor_headers,
    )
    assert first_save.status_code == 200, first_save.text
    revisions_after_first_save = list_revisions(client, editor_headers, project["id"])
    current_revision = next(item for item in revisions_after_first_save if item["is_current"] is True)

    add_comment_response = client.post(
        f"/api/v1/projects/{project['id']}/comments",
        headers=editor_headers,
        json={
            "text": "Монтаж: 00:00:18-00:00:24 заменить кадры",
            "target_kind": "edit",
            "requires_action": True,
        },
    )
    assert add_comment_response.status_code == 200, add_comment_response.text
    comment_payload = add_comment_response.json()
    assert comment_payload["target_kind"] == "edit"
    assert comment_payload["requires_action"] is True
    assert comment_payload["is_resolved"] is False
    assert comment_payload["created_text_snapshot_kind"] == "current"
    assert comment_payload["created_text_seq"] == 1
    assert comment_payload["created_revision_no"] == current_revision["revision_no"]

    editor_payload = client.get(
        f"/api/v1/projects/{project['id']}/editor",
        headers=editor_headers,
    )
    assert editor_payload.status_code == 200, editor_payload.text
    saved_rows = editor_payload.json()["elements"]
    next_rows = [dict(saved_rows[0])]
    next_rows[0]["text"] = "Вторая версия для закрытия правки по монтажу"
    second_save = client.put(
        f"/api/v1/projects/{project['id']}/editor",
        json={"rows": next_rows},
        headers=editor_headers,
    )
    assert second_save.status_code == 200, second_save.text
    new_revision = create_revision(
        client,
        editor_headers,
        project["id"],
        title="После второй версии текста",
        comment="Зафиксировали версию для закрытия правки",
    )
    submitted_revision = submit_revision(client, editor_headers, project["id"], new_revision["id"])
    assert submitted_revision["status"] == "submitted"
    approved_revision = approve_revision(client, editor_headers, project["id"], new_revision["id"])
    assert approved_revision["status"] == "approved"
    mark_current_response = client.post(
        f"/api/v1/projects/{project['id']}/revisions/{new_revision['id']}/mark-current",
        headers=editor_headers,
    )
    assert mark_current_response.status_code == 200, mark_current_response.text

    set_current_response = client.post(
        f"/api/v1/projects/{project['id']}/text/current",
        json={"text_seq": 2},
        headers=editor_headers,
    )
    assert set_current_response.status_code == 200, set_current_response.text

    project_list_after_add = list_projects(client, editor_headers)
    updated_project = find_project(project_list_after_add, title=project["title"])
    assert updated_project["open_action_comment_count"] >= 1
    assert updated_project["open_edit_action_comment_count"] >= 1

    resolve_response = client.post(
        f"/api/v1/projects/{project['id']}/comments/{comment_payload['id']}/resolution",
        headers=editor_headers,
        json={"is_resolved": True},
    )
    assert resolve_response.status_code == 200, resolve_response.text
    resolved_payload = resolve_response.json()
    assert resolved_payload["is_resolved"] is True
    assert resolved_payload["resolved_at"] is not None
    assert resolved_payload["resolved_text_snapshot_kind"] == "current"
    assert resolved_payload["resolved_text_seq"] == 2
    assert resolved_payload["resolved_revision_no"] == new_revision["revision_no"]

    project_list_after_resolve = list_projects(client, editor_headers)
    resolved_project = find_project(project_list_after_resolve, title=project["title"])
    assert resolved_project["open_edit_action_comment_count"] == 0

    history_response = client.get(
        f"/api/v1/projects/{project['id']}/history",
        headers=editor_headers,
    )
    assert history_response.status_code == 200, history_response.text
    history_items = history_response.json()["items"]
    assert any(item["event_type"] == "comment_added" for item in history_items)
    assert any(item["event_type"] == "comment_resolved" for item in history_items)


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


def test_multiple_file_bundles_round_trip_through_structured_data(client) -> None:
    headers, _user = login(client, "editor", "editor123")
    project = find_project(list_projects(client, headers), status="draft")

    save_response = client.put(
        f"/api/v1/projects/{project['id']}/editor",
        json={
            "rows": [
                {
                    "order_index": 1,
                    "block_type": "zk",
                    "text": "Текст для нескольких файлов",
                    "speaker_text": "",
                    "file_name": "master-a.mov",
                    "tc_in": "00:00",
                    "tc_out": "00:10",
                    "additional_comment": "",
                    "structured_data": {
                        "file_bundles": [
                            {
                                "file_name": "master-a.mov",
                                "tc_in": "00:00",
                                "tc_out": "00:10",
                            },
                            {
                                "file_name": "master-b.mov",
                                "tc_in": "00:11",
                                "tc_out": "00:21",
                            },
                        ]
                    },
                    "formatting": {},
                }
            ]
        },
        headers=headers,
    )
    assert save_response.status_code == 200, save_response.text
    payload = save_response.json()
    assert payload["elements"][0]["file_name"] == "master-a.mov"
    assert payload["elements"][0]["tc_in"] == "00:00"
    assert payload["elements"][0]["tc_out"] == "00:10"
    assert payload["elements"][0]["structured_data"]["file_bundles"] == [
        {
            "file_name": "master-a.mov",
            "tc_in": "00:00",
            "tc_out": "00:10",
        },
        {
            "file_name": "master-b.mov",
            "tc_in": "00:11",
            "tc_out": "00:21",
        },
    ]

    editor_response = client.get(
        f"/api/v1/projects/{project['id']}/editor",
        headers=headers,
    )
    assert editor_response.status_code == 200, editor_response.text
    editor_payload = editor_response.json()
    assert editor_payload["elements"][0]["structured_data"]["file_bundles"][1]["file_name"] == "master-b.mov"


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


def test_story_exchange_export_returns_structured_json(client) -> None:
    headers, _user = login(client, "editor", "editor123")
    project = find_project(list_projects(client, headers), status="draft")

    save_response = client.put(
        f"/api/v1/projects/{project['id']}/editor",
        json={
            "rows": [
                {
                    "order_index": 1,
                    "block_type": "zk",
                    "text": "Текст закадра",
                    "speaker_text": "",
                    "file_name": "master-a.mov",
                    "tc_in": "00:00",
                    "tc_out": "00:10",
                    "additional_comment": "текст",
                },
                {
                    "order_index": 2,
                    "block_type": "zk_geo",
                    "text": "Первая строка\nВторая строка",
                    "speaker_text": "",
                    "file_name": "master-b.mov",
                    "tc_in": "00:11",
                    "tc_out": "00:20",
                    "additional_comment": "",
                    "structured_data": {
                        "geo": "Москва",
                        "text_lines": ["Первая строка", "Вторая строка"],
                    },
                },
                {
                    "order_index": 3,
                    "block_type": "snh",
                    "text": "Текст синхрона",
                    "speaker_text": "Иван Иванов\nРедактор",
                    "file_name": "sync.mov",
                    "tc_in": "00:21",
                    "tc_out": "00:35",
                    "additional_comment": "",
                },
                {
                    "order_index": 4,
                    "block_type": "life",
                    "text": "Интершум цеха",
                    "speaker_text": "",
                    "file_name": "life.mov",
                    "tc_in": "00:36",
                    "tc_out": "00:42",
                    "additional_comment": "",
                },
            ]
        },
        headers=headers,
    )
    assert save_response.status_code == 200, save_response.text
    saved_rows = save_response.json()["elements"]

    export_response = client.get(
        f"/api/v1/projects/{project['id']}/export/story-exchange",
        headers=headers,
    )
    assert export_response.status_code == 200, export_response.text
    assert export_response.headers["content-type"].startswith("application/json")
    payload = export_response.json()

    assert payload["schemaVersion"] == 1
    assert payload["storyUid"] == f"story_{project['id']}"
    assert payload["source"]["system"] == "newscastnavigator"
    assert payload["project"]["id"] == project["id"]
    assert payload["project"]["status"] == project["status"]
    assert [item["segmentUid"] for item in payload["segments"]] == [
        item["segment_uid"] for item in saved_rows
    ]

    first_segment, second_segment, third_segment, fourth_segment = payload["segments"]
    assert first_segment["semanticType"] == "voiceover"
    assert first_segment["notes"]["onScreen"] == "текст"
    assert first_segment["file"]["name"] == "master-a.mov"

    assert second_segment["blockType"] == "zk_geo"
    assert second_segment["semanticType"] == "voiceover"
    assert second_segment["geo"] == "Москва"
    assert second_segment["textLines"] == ["Первая строка", "Вторая строка"]

    assert third_segment["semanticType"] == "sync"
    assert third_segment["speakerId"]
    assert payload["speakers"] == [
        {
            "speakerId": third_segment["speakerId"],
            "name": "Иван Иванов",
            "job": "Редактор",
        }
    ]

    assert fourth_segment["blockType"] == "life"
    assert fourth_segment["semanticType"] == "sync"
    assert "speakerId" not in fourth_segment

    export_root = Path(os.environ["EXPORT_PATH"])
    exported_files = sorted(
        export_root.glob(f"projects/{project['id']}/newscast_project_{project['id']}_story_exchange_v1-*.json")
    )
    assert exported_files


def test_story_exchange_deduplicates_speakers_within_story(client) -> None:
    headers, _user = login(client, "editor", "editor123")
    project = find_project(list_projects(client, headers), status="draft")

    save_response = client.put(
        f"/api/v1/projects/{project['id']}/editor",
        json={
            "rows": [
                {
                    "order_index": 1,
                    "block_type": "snh",
                    "text": "Первая реплика",
                    "speaker_text": "Иван Иванов\nРедактор",
                    "file_name": "",
                    "tc_in": "",
                    "tc_out": "",
                    "additional_comment": "",
                },
                {
                    "order_index": 2,
                    "block_type": "snh",
                    "text": "Вторая реплика",
                    "speaker_text": "Иван Иванов\nРедактор",
                    "file_name": "",
                    "tc_in": "",
                    "tc_out": "",
                    "additional_comment": "",
                },
            ]
        },
        headers=headers,
    )
    assert save_response.status_code == 200, save_response.text

    export_response = client.get(
        f"/api/v1/projects/{project['id']}/export/story-exchange",
        headers=headers,
    )
    assert export_response.status_code == 200, export_response.text
    payload = export_response.json()
    assert len(payload["speakers"]) == 1
    speaker_ids = [item["speakerId"] for item in payload["segments"]]
    assert speaker_ids[0] == speaker_ids[1]


def test_captionpanels_integration_lists_projects_and_returns_selected_import_json(client) -> None:
    headers, _user = login(client, "editor", "editor123")

    draft_project = find_project(list_projects(client, headers), status="draft")
    archived_project = find_project(list_projects(client, headers, view="archive"), status="archived")

    integration_list_response = client.get(
        "/api/v1/integrations/captionpanels/projects",
        headers=headers,
    )
    assert integration_list_response.status_code == 200, integration_list_response.text
    integration_payload = integration_list_response.json()
    integration_items = integration_payload["items"]
    assert integration_payload["total"] == len(integration_items)
    assert any(item["projectId"] == draft_project["id"] for item in integration_items)
    assert all(item["projectId"] != archived_project["id"] for item in integration_items)

    selected_item = next(item for item in integration_items if item["projectId"] == draft_project["id"])
    assert selected_item["storyUid"] == f"story_{draft_project['id']}"
    assert selected_item["segmentCount"] >= 1
    assert "syncSegmentCount" in selected_item

    filtered_response = client.get(
        "/api/v1/integrations/captionpanels/projects",
        params={"search": draft_project["title"]},
        headers=headers,
    )
    assert filtered_response.status_code == 200, filtered_response.text
    filtered_items = filtered_response.json()["items"]
    assert filtered_items
    assert all(item["projectId"] == draft_project["id"] for item in filtered_items)

    archived_response = client.get(
        "/api/v1/integrations/captionpanels/projects",
        params={"include_archived": "true"},
        headers=headers,
    )
    assert archived_response.status_code == 200, archived_response.text
    archived_items = archived_response.json()["items"]
    assert any(item["projectId"] == archived_project["id"] for item in archived_items)

    integration_import_response = client.get(
        f"/api/v1/integrations/captionpanels/projects/{draft_project['id']}/import-json",
        headers=headers,
    )
    assert integration_import_response.status_code == 200, integration_import_response.text

    export_import_response = client.get(
        f"/api/v1/projects/{draft_project['id']}/export/captionpanels-import",
        headers=headers,
    )
    assert export_import_response.status_code == 200, export_import_response.text
    assert integration_import_response.json() == export_import_response.json()


def test_editor_load_synthesizes_rich_text_from_plain_storage(client) -> None:
    headers, _user = login(client, "editor", "editor123")
    project = find_project(list_projects(client, headers), status="draft")

    editor_response = client.get(
        f"/api/v1/projects/{project['id']}/editor",
        headers=headers,
    )
    assert editor_response.status_code == 200, editor_response.text
    rows = editor_response.json()["elements"]
    assert rows

    podvodka_row = rows[0]
    assert podvodka_row["rich_text"]["schema_version"] == 1
    assert podvodka_row["rich_text"]["targets"]["text"]["editor"] == "legacy_html"
    assert podvodka_row["rich_text"]["targets"]["text"]["text"] == podvodka_row["text"]

    snh_row = next(item for item in rows if item["block_type"] == "snh")
    assert snh_row["rich_text"]["targets"]["speaker_fio"]["text"] == "Эдуард Еникеев"
    assert snh_row["rich_text"]["targets"]["speaker_position"]["text"] == "Начальник ЛПДС"
    assert snh_row["rich_text"]["targets"]["text"]["text"] == snh_row["text"]


def test_editor_save_persists_explicit_rich_text_state(client) -> None:
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
                    "file_name": "",
                    "tc_in": "",
                    "tc_out": "",
                    "additional_comment": "",
                    "structured_data": {
                        "geo": "Москва",
                        "text_lines": ["Первая строка", "Вторая строка"],
                    },
                    "formatting": {
                        "targets": {
                            "text": {
                                "font_family": "PT Sans",
                                "bold": False,
                                "italic": False,
                                "strikethrough": False,
                                "fill_color": "#f4f6f9",
                            },
                            "geo": {
                                "font_family": "PT Sans",
                                "bold": False,
                                "italic": True,
                                "strikethrough": False,
                                "fill_color": "#f4f6f9",
                            },
                        }
                    },
                    "rich_text": {
                        "schema_version": 1,
                        "targets": {
                            "text": {
                                "editor": "legacy_html",
                                "text": "Первая строка\nВторая строка",
                                "html": "<strong>Первая строка</strong><br>Вторая строка",
                            },
                            "geo": {
                                "editor": "legacy_html",
                                "text": "Москва",
                                "html": "<em>Москва</em>",
                            },
                        },
                    },
                }
            ]
        },
        headers=headers,
    )
    assert save_response.status_code == 200, save_response.text
    saved_row = save_response.json()["elements"][0]
    assert saved_row["rich_text"]["targets"]["text"]["html"] == "<strong>Первая строка</strong><br>Вторая строка"
    assert saved_row["rich_text"]["targets"]["geo"]["html"] == "<em>Москва</em>"

    editor_response = client.get(
        f"/api/v1/projects/{project['id']}/editor",
        headers=headers,
    )
    assert editor_response.status_code == 200, editor_response.text
    persisted_row = editor_response.json()["elements"][0]
    assert persisted_row["rich_text"]["targets"]["text"]["html"] == "<strong>Первая строка</strong><br>Вторая строка"
    assert persisted_row["rich_text"]["targets"]["text"]["text"] == "Первая строка\nВторая строка"
    assert persisted_row["rich_text"]["targets"]["geo"]["html"] == "<em>Москва</em>"


def test_captionpanels_import_export_maps_story_segments(client) -> None:
    headers, _user = login(client, "editor", "editor123")
    project = find_project(list_projects(client, headers), status="draft")

    save_response = client.put(
        f"/api/v1/projects/{project['id']}/editor",
        json={
            "rows": [
                {
                    "order_index": 1,
                    "block_type": "podvodka",
                    "text": "Подводка для выпуска",
                    "speaker_text": "",
                    "file_name": "",
                    "tc_in": "",
                    "tc_out": "",
                    "additional_comment": "",
                },
                {
                    "order_index": 2,
                    "block_type": "zk",
                    "text": "Текст закадра 1",
                    "speaker_text": "",
                    "file_name": "master-a.mov",
                    "tc_in": "00:00",
                    "tc_out": "00:10",
                    "additional_comment": "",
                },
                {
                    "order_index": 3,
                    "block_type": "zk",
                    "text": "Текст закадра 2",
                    "speaker_text": "",
                    "file_name": "master-a.mov",
                    "tc_in": "00:10",
                    "tc_out": "00:20",
                    "additional_comment": "",
                },
                {
                    "order_index": 4,
                    "block_type": "zk_geo",
                    "text": "Текст после гео",
                    "speaker_text": "",
                    "file_name": "master-b.mov",
                    "tc_in": "00:21",
                    "tc_out": "00:30",
                    "additional_comment": "",
                    "structured_data": {
                        "geo": "Москва",
                        "text_lines": ["Текст после гео"],
                    },
                },
                {
                    "order_index": 5,
                    "block_type": "snh",
                    "text": "Текст синхрона",
                    "speaker_text": "Иван Иванов\nРедактор",
                    "file_name": "sync.mov",
                    "tc_in": "00:31",
                    "tc_out": "00:45",
                    "additional_comment": "",
                },
                {
                    "order_index": 6,
                    "block_type": "life",
                    "text": "Интершум",
                    "speaker_text": "",
                    "file_name": "life.mov",
                    "tc_in": "00:46",
                    "tc_out": "00:52",
                    "additional_comment": "",
                },
            ]
        },
        headers=headers,
    )
    assert save_response.status_code == 200, save_response.text
    saved_rows = save_response.json()["elements"]

    export_response = client.get(
        f"/api/v1/projects/{project['id']}/export/captionpanels-import",
        headers=headers,
    )
    assert export_response.status_code == 200, export_response.text
    assert export_response.headers["content-type"].startswith("application/json")
    payload = export_response.json()

    assert payload["meta"]["title"] == project["title"]
    assert payload["meta"]["rubric"] == project["rubric"]
    assert payload["speakers"] == [
        {
            "id": payload["segments"][3]["speakerId"],
            "name": "Иван Иванов",
            "job": "Редактор",
        }
    ]

    assert [item["type"] for item in payload["segments"]] == [
        "voiceover",
        "geotag",
        "voiceover",
        "synch",
        "life",
    ]
    assert payload["segments"][0]["id"] == saved_rows[1]["segment_uid"]
    assert payload["segments"][0]["text"] == "Текст закадра 1\nТекст закадра 2"
    assert payload["segments"][1] == {
        "id": f"{saved_rows[3]['segment_uid']}:geo",
        "type": "geotag",
        "text": "Москва",
    }
    assert payload["segments"][2]["id"] == saved_rows[3]["segment_uid"]
    assert payload["segments"][2]["text"] == "Текст после гео"
    assert payload["segments"][3]["id"] == saved_rows[4]["segment_uid"]
    assert payload["segments"][3]["speakerId"] == payload["speakers"][0]["id"]
    assert payload["segments"][4]["id"] == saved_rows[5]["segment_uid"]
    assert "speakerId" not in payload["segments"][4]

    export_root = Path(os.environ["EXPORT_PATH"])
    exported_files = sorted(
        export_root.glob(
            f"projects/{project['id']}/newscast_project_{project['id']}_captionpanels_import-*.json"
        )
    )
    assert exported_files


def test_captionpanels_export_skips_struck_text(client) -> None:
    headers, _user = login(client, "editor", "editor123")
    project = find_project(list_projects(client, headers), status="draft")

    save_response = client.put(
        f"/api/v1/projects/{project['id']}/editor",
        json={
            "rows": [
                {
                    "order_index": 1,
                    "block_type": "zk",
                    "text": "Оставить убрать финал",
                    "speaker_text": "",
                    "file_name": "",
                    "tc_in": "",
                    "tc_out": "",
                    "additional_comment": "",
                    "rich_text": {
                        "schema_version": 1,
                        "targets": {
                            "text": {
                                "editor": "tiptap",
                                "text": "Оставить убрать финал",
                                "html": "<p>Оставить <s>убрать</s> финал</p>",
                            }
                        },
                    },
                }
            ]
        },
        headers=headers,
    )
    assert save_response.status_code == 200, save_response.text

    export_response = client.get(
        f"/api/v1/projects/{project['id']}/export/captionpanels-import",
        headers=headers,
    )
    assert export_response.status_code == 200, export_response.text
    payload = export_response.json()

    assert payload["segments"] == [
        {
            "id": payload["segments"][0]["id"],
            "type": "voiceover",
            "text": "Оставить финал",
        }
    ]


def test_revision_lazy_baseline_created_once(client) -> None:
    headers, _user = login(client, "editor", "editor123")
    project = find_project(list_projects(client, headers), status="draft")

    first_items = list_revisions(client, headers, project["id"])
    assert len(first_items) == 1
    baseline = first_items[0]
    assert baseline["revision_no"] == 1
    assert baseline["revision_kind"] == "baseline"
    assert baseline["status"] == "approved"
    assert baseline["is_current"] is True
    assert baseline["project_title"] == project["title"]

    second_items = list_revisions(client, headers, project["id"])
    assert len(second_items) == 1
    assert second_items[0]["id"] == baseline["id"]


def test_create_revision_snapshots_header_and_rows(client) -> None:
    headers, _user = login(client, "editor", "editor123")
    project = find_project(list_projects(client, headers), status="draft")

    meta_response = client.put(
        f"/api/v1/projects/{project['id']}/meta",
        json={
            "title": "Revision snapshot title",
            "rubric": "Новая рубрика",
            "planned_duration": "03:30",
        },
        headers=headers,
    )
    assert meta_response.status_code == 200, meta_response.text

    editor_response = client.get(f"/api/v1/projects/{project['id']}/editor", headers=headers)
    assert editor_response.status_code == 200, editor_response.text
    rows = editor_response.json()["elements"]
    assert rows
    rows[0]["text"] = "Текст для snapshot"
    save_response = client.put(
        f"/api/v1/projects/{project['id']}/editor",
        json={"rows": rows},
        headers=headers,
    )
    assert save_response.status_code == 200, save_response.text
    saved_rows = save_response.json()["elements"]

    revision = create_revision(
        client,
        headers,
        project["id"],
        title="После правок",
        comment="Снимок шапки и текста",
    )
    assert revision["revision_no"] == 2
    assert revision["revision_kind"] == "manual"
    assert revision["status"] == "draft"
    assert revision["is_current"] is False
    assert revision["project_title"] == "Revision snapshot title"
    assert revision["project_rubric"] == "Новая рубрика"
    assert revision["project_planned_duration"] == "03:30"

    detail_response = client.get(
        f"/api/v1/projects/{project['id']}/revisions/{revision['id']}",
        headers=headers,
    )
    assert detail_response.status_code == 200, detail_response.text
    assert detail_response.json()["revision"]["title"] == "После правок"

    elements_response = client.get(
        f"/api/v1/projects/{project['id']}/revisions/{revision['id']}/elements",
        headers=headers,
    )
    assert elements_response.status_code == 200, elements_response.text
    snapshot_rows = elements_response.json()["elements"]
    assert len(snapshot_rows) == len(saved_rows)
    assert snapshot_rows[0]["segment_uid"] == saved_rows[0]["segment_uid"]
    assert snapshot_rows[0]["text"] == "Текст для snapshot"


def test_restore_revision_restores_workspace_but_not_current(client) -> None:
    headers, _user = login(client, "editor", "editor123")
    project = find_project(list_projects(client, headers), status="draft")

    baseline_items = list_revisions(client, headers, project["id"])
    assert len(baseline_items) == 1
    baseline = baseline_items[0]

    baseline_detail_response = client.get(
        f"/api/v1/projects/{project['id']}/revisions/{baseline['id']}/elements",
        headers=headers,
    )
    assert baseline_detail_response.status_code == 200, baseline_detail_response.text
    baseline_rows = baseline_detail_response.json()["elements"]
    assert baseline_rows

    meta_b_response = client.put(
        f"/api/v1/projects/{project['id']}/meta",
        json={
            "title": "State B title",
            "rubric": "State B rubric",
            "planned_duration": "02:45",
        },
        headers=headers,
    )
    assert meta_b_response.status_code == 200, meta_b_response.text

    editor_b_response = client.get(f"/api/v1/projects/{project['id']}/editor", headers=headers)
    assert editor_b_response.status_code == 200, editor_b_response.text
    state_b_rows = editor_b_response.json()["elements"]
    state_b_rows[0]["text"] = "State B text"
    save_b_response = client.put(
        f"/api/v1/projects/{project['id']}/editor",
        json={"rows": state_b_rows},
        headers=headers,
    )
    assert save_b_response.status_code == 200, save_b_response.text

    revision_b = create_revision(client, headers, project["id"], title="State B", comment="Approved branch point")
    submitted_revision_b = submit_revision(client, headers, project["id"], revision_b["id"])
    assert submitted_revision_b["status"] == "submitted"
    approved_revision_b = approve_revision(client, headers, project["id"], revision_b["id"])
    assert approved_revision_b["status"] == "approved"

    mark_current_response = client.post(
        f"/api/v1/projects/{project['id']}/revisions/{revision_b['id']}/mark-current",
        headers=headers,
    )
    assert mark_current_response.status_code == 200, mark_current_response.text

    meta_c_response = client.put(
        f"/api/v1/projects/{project['id']}/meta",
        json={
            "title": "State C title",
            "rubric": "State C rubric",
            "planned_duration": "05:00",
        },
        headers=headers,
    )
    assert meta_c_response.status_code == 200, meta_c_response.text

    editor_c_response = client.get(f"/api/v1/projects/{project['id']}/editor", headers=headers)
    assert editor_c_response.status_code == 200, editor_c_response.text
    state_c_rows = editor_c_response.json()["elements"]
    state_c_rows[0]["text"] = "State C text"
    save_c_response = client.put(
        f"/api/v1/projects/{project['id']}/editor",
        json={"rows": state_c_rows},
        headers=headers,
    )
    assert save_c_response.status_code == 200, save_c_response.text

    restore_response = client.post(
        f"/api/v1/projects/{project['id']}/revisions/{baseline['id']}/restore-to-workspace",
        headers=headers,
    )
    assert restore_response.status_code == 200, restore_response.text

    restored_editor_response = client.get(f"/api/v1/projects/{project['id']}/editor", headers=headers)
    assert restored_editor_response.status_code == 200, restored_editor_response.text
    restored_payload = restored_editor_response.json()
    assert restored_payload["project"]["title"] == baseline["project_title"]
    assert restored_payload["project"]["rubric"] == baseline["project_rubric"]
    assert restored_payload["project"]["planned_duration"] == baseline["project_planned_duration"]
    assert restored_payload["elements"][0]["segment_uid"] == baseline_rows[0]["segment_uid"]
    assert restored_payload["elements"][0]["text"] == baseline_rows[0]["text"]

    items_after_restore = list_revisions(client, headers, project["id"])
    current_items = [item for item in items_after_restore if item["is_current"]]
    assert len(current_items) == 1
    assert current_items[0]["id"] == revision_b["id"]


def test_mark_current_switches_single_current_revision(client) -> None:
    headers, _user = login(client, "editor", "editor123")
    project = find_project(list_projects(client, headers), status="draft")

    baseline_items = list_revisions(client, headers, project["id"])
    assert len(baseline_items) == 1
    baseline = baseline_items[0]

    revision = create_revision(client, headers, project["id"], title="Новая текущая", comment="Для current smoke")
    draft_mark_response = client.post(
        f"/api/v1/projects/{project['id']}/revisions/{revision['id']}/mark-current",
        headers=headers,
    )
    assert draft_mark_response.status_code == 409, draft_mark_response.text
    assert "утвержден" in draft_mark_response.json()["detail"].lower()

    submitted_revision = submit_revision(client, headers, project["id"], revision["id"])
    assert submitted_revision["status"] == "submitted"
    approved_revision = approve_revision(client, headers, project["id"], revision["id"])
    assert approved_revision["status"] == "approved"
    mark_response = client.post(
        f"/api/v1/projects/{project['id']}/revisions/{revision['id']}/mark-current",
        headers=headers,
    )
    assert mark_response.status_code == 200, mark_response.text
    assert mark_response.json()["revision"]["status"] == "approved"

    items = list_revisions(client, headers, project["id"])
    current_items = [item for item in items if item["is_current"]]
    assert len(current_items) == 1
    assert current_items[0]["id"] == revision["id"]
    previous_baseline = next(item for item in items if item["id"] == baseline["id"])
    assert previous_baseline["is_current"] is False


def test_revision_diff_reports_header_and_row_changes(client) -> None:
    headers, _user = login(client, "editor", "editor123")

    create_response = client.post(
        "/api/v1/projects",
        json={"title": "Revision diff smoke"},
        headers=headers,
    )
    assert create_response.status_code == 200, create_response.text
    project = create_response.json()["project"]

    baseline_rows_payload = [
        {
            "order_index": 1,
            "block_type": "zk",
            "text": "Первая строка",
            "speaker_text": "",
            "file_name": "master-a.mov",
            "tc_in": "00:00",
            "tc_out": "00:10",
            "additional_comment": "",
        },
        {
            "order_index": 2,
            "block_type": "snh",
            "text": "Текст синхрона",
            "speaker_text": "Иван Иванов\nМастер",
            "file_name": "sync-a.mov",
            "tc_in": "00:11",
            "tc_out": "00:20",
            "additional_comment": "",
        },
        {
            "order_index": 3,
            "block_type": "life",
            "text": "Интершум",
            "speaker_text": "",
            "file_name": "life-a.mov",
            "tc_in": "00:21",
            "tc_out": "00:30",
            "additional_comment": "",
        },
    ]
    save_baseline_response = client.put(
        f"/api/v1/projects/{project['id']}/editor",
        json={"rows": baseline_rows_payload},
        headers=headers,
    )
    assert save_baseline_response.status_code == 200, save_baseline_response.text
    baseline_saved_rows = save_baseline_response.json()["elements"]
    baseline_row_1 = baseline_saved_rows[0]
    baseline_row_2 = baseline_saved_rows[1]
    baseline_row_3 = baseline_saved_rows[2]

    baseline_revision = list_revisions(client, headers, project["id"])[0]
    assert baseline_revision["revision_kind"] == "baseline"

    meta_update_response = client.put(
        f"/api/v1/projects/{project['id']}/meta",
        json={
            "title": "Revision diff smoke updated",
            "rubric": "Diff rubric",
            "planned_duration": "04:20",
        },
        headers=headers,
    )
    assert meta_update_response.status_code == 200, meta_update_response.text

    changed_rows_payload = [
        {
            "segment_uid": baseline_row_2["segment_uid"],
            "order_index": 1,
            "block_type": baseline_row_2["block_type"],
            "text": baseline_row_2["text"],
            "speaker_text": baseline_row_2["speaker_text"],
            "file_name": baseline_row_2["file_name"],
            "tc_in": baseline_row_2["tc_in"],
            "tc_out": baseline_row_2["tc_out"],
            "additional_comment": baseline_row_2["additional_comment"],
            "structured_data": baseline_row_2["structured_data"],
            "formatting": baseline_row_2["formatting"],
            "rich_text": baseline_row_2["rich_text"],
        },
        {
            "segment_uid": baseline_row_1["segment_uid"],
            "order_index": 2,
            "block_type": baseline_row_1["block_type"],
            "text": "Первая строка после правок",
            "speaker_text": baseline_row_1["speaker_text"],
            "file_name": baseline_row_1["file_name"],
            "tc_in": baseline_row_1["tc_in"],
            "tc_out": baseline_row_1["tc_out"],
            "additional_comment": "Комментарий изменен",
            "structured_data": baseline_row_1["structured_data"],
            "formatting": baseline_row_1["formatting"],
            "rich_text": baseline_row_1["rich_text"],
        },
        {
            "order_index": 3,
            "block_type": "zk_geo",
            "text": "Новая строка с гео",
            "speaker_text": "",
            "file_name": "master-b.mov",
            "tc_in": "00:31",
            "tc_out": "00:40",
            "additional_comment": "",
            "structured_data": {
                "geo": "Уфа",
                "text_lines": ["Новая строка с гео"],
            },
            "formatting": {},
            "rich_text": {},
        },
    ]
    save_changed_response = client.put(
        f"/api/v1/projects/{project['id']}/editor",
        json={"rows": changed_rows_payload},
        headers=headers,
    )
    assert save_changed_response.status_code == 200, save_changed_response.text

    changed_revision = create_revision(
        client,
        headers,
        project["id"],
        title="После diff-правок",
        comment="Для проверки diff",
    )

    diff_response = client.get(
        f"/api/v1/projects/{project['id']}/revisions/{changed_revision['id']}/diff",
        params={"against": baseline_revision["id"]},
        headers=headers,
    )
    assert diff_response.status_code == 200, diff_response.text
    diff_payload = diff_response.json()

    assert diff_payload["revision"]["id"] == changed_revision["id"]
    assert diff_payload["against_revision"]["id"] == baseline_revision["id"]
    assert {item["field"] for item in diff_payload["header_changes"]} == {
        "title",
        "rubric",
        "planned_duration",
    }
    assert diff_payload["summary"]["added"] == 1
    assert diff_payload["summary"]["removed"] == 1
    assert diff_payload["summary"]["changed"] == 1
    assert diff_payload["summary"]["moved"] == 2
    assert diff_payload["summary"]["total"] == 4

    row_changes = {item["segment_uid"]: item for item in diff_payload["row_changes"]}
    assert baseline_row_3["segment_uid"] in row_changes
    assert "removed" in row_changes[baseline_row_3["segment_uid"]]["change_types"]

    assert baseline_row_2["segment_uid"] in row_changes
    assert "moved" in row_changes[baseline_row_2["segment_uid"]]["change_types"]

    assert baseline_row_1["segment_uid"] in row_changes
    assert row_changes[baseline_row_1["segment_uid"]]["change_types"] == ["changed", "moved"]
    assert set(row_changes[baseline_row_1["segment_uid"]]["changed_fields"]) == {
        "text",
        "additional_comment",
    }

    added_change = next(
        item for item in diff_payload["row_changes"] if "added" in item["change_types"]
    )
    assert added_change["after_row"]["block_type"] == "zk_geo"
    assert added_change["after_row"]["structured_data"]["geo"] == "Уфа"


def test_revision_workflow_submit_approve_reject(client) -> None:
    editor_headers, _editor_user = login(client, "editor", "editor123")
    author_headers, _author_user = login(client, "author", "author123")
    project = find_project(list_projects(client, editor_headers), status="draft")

    revision = create_revision(
        client,
        author_headers,
        project["id"],
        title="Workflow version",
        comment="Проверка workflow",
    )
    assert revision["status"] == "draft"

    submitted_revision = submit_revision(client, author_headers, project["id"], revision["id"])
    assert submitted_revision["status"] == "submitted"

    reject_response = reject_revision(client, editor_headers, project["id"], revision["id"])
    assert reject_response["status"] == "rejected"

    resubmitted_revision = submit_revision(client, author_headers, project["id"], revision["id"])
    assert resubmitted_revision["status"] == "submitted"

    approved_revision = approve_revision(client, editor_headers, project["id"], revision["id"])
    assert approved_revision["status"] == "approved"

    history_response = client.get(
        f"/api/v1/projects/{project['id']}/history",
        headers=editor_headers,
    )
    assert history_response.status_code == 200, history_response.text
    history_items = history_response.json()["items"]
    assert any(item["event_type"] == "revision_submitted" for item in history_items)
    assert any(item["event_type"] == "revision_rejected" for item in history_items)
    assert any(item["event_type"] == "revision_approved" for item in history_items)


def test_revision_branch_and_merge_flow(client) -> None:
    editor_headers, _editor_user = login(client, "editor", "editor123")
    project = find_project(list_projects(client, editor_headers), status="draft")

    baseline_items = list_revisions(client, editor_headers, project["id"])
    baseline = baseline_items[0]

    branch_root = branch_revision(
        client,
        editor_headers,
        project["id"],
        baseline["id"],
        branch_key="chief",
        title="Chief branch root",
        comment="Старт ветки",
    )
    assert branch_root["branch_key"] == "chief"
    assert branch_root["revision_kind"] == "branch"
    assert branch_root["status"] == "draft"
    assert branch_root["parent_revision_id"] == baseline["id"]

    meta_response = client.put(
        f"/api/v1/projects/{project['id']}/meta",
        json={
            "title": "Chief merged title",
            "rubric": "Chief rubric",
            "planned_duration": "06:00",
        },
        headers=editor_headers,
    )
    assert meta_response.status_code == 200, meta_response.text

    editor_response = client.get(f"/api/v1/projects/{project['id']}/editor", headers=editor_headers)
    assert editor_response.status_code == 200, editor_response.text
    branch_rows = editor_response.json()["elements"]
    branch_rows[0]["text"] = "Текст для ветки chief"
    save_response = client.put(
        f"/api/v1/projects/{project['id']}/editor",
        json={"rows": branch_rows},
        headers=editor_headers,
    )
    assert save_response.status_code == 200, save_response.text

    branch_create_response = client.post(
        f"/api/v1/projects/{project['id']}/revisions",
        json={
            "title": "Chief edit v2",
            "comment": "Продолжение ветки",
            "branch_key": "chief",
            "parent_revision_id": branch_root["id"],
        },
        headers=editor_headers,
    )
    assert branch_create_response.status_code == 200, branch_create_response.text
    branch_revision_payload = branch_create_response.json()["revision"]
    assert branch_revision_payload["branch_key"] == "chief"
    assert branch_revision_payload["parent_revision_id"] == branch_root["id"]

    submitted_branch = submit_revision(client, editor_headers, project["id"], branch_revision_payload["id"])
    assert submitted_branch["status"] == "submitted"
    approved_branch = approve_revision(client, editor_headers, project["id"], branch_revision_payload["id"])
    assert approved_branch["status"] == "approved"

    merged_revision = merge_revision_to_main(
        client,
        editor_headers,
        project["id"],
        branch_revision_payload["id"],
    )
    assert merged_revision["branch_key"] == "main"
    assert merged_revision["revision_kind"] == "merge"
    assert merged_revision["status"] == "approved"
    assert merged_revision["is_current"] is True

    merged_editor_response = client.get(f"/api/v1/projects/{project['id']}/editor", headers=editor_headers)
    assert merged_editor_response.status_code == 200, merged_editor_response.text
    merged_payload = merged_editor_response.json()
    assert merged_payload["project"]["title"] == "Chief merged title"
    assert merged_payload["project"]["rubric"] == "Chief rubric"
    assert merged_payload["project"]["planned_duration"] == "06:00"
    assert merged_payload["elements"][0]["text"] == "Текст для ветки chief"

    history_response = client.get(
        f"/api/v1/projects/{project['id']}/history",
        headers=editor_headers,
    )
    assert history_response.status_code == 200, history_response.text
    history_items = history_response.json()["items"]
    assert any(item["event_type"] == "revision_branched" for item in history_items)
    assert any(item["event_type"] == "revision_merged" for item in history_items)


def test_revision_permissions(client) -> None:
    editor_headers, _editor_user = login(client, "editor", "editor123")
    author_headers, _author_user = login(client, "author", "author123")
    proof_headers, _proof_user = login(client, "proofreader", "proof123")
    project = find_project(list_projects(client, editor_headers), status="draft")

    author_revision_response = client.post(
        f"/api/v1/projects/{project['id']}/revisions",
        json={"title": "Авторская версия", "comment": ""},
        headers=author_headers,
    )
    assert author_revision_response.status_code == 200, author_revision_response.text
    author_revision = author_revision_response.json()["revision"]

    author_restore_response = client.post(
        f"/api/v1/projects/{project['id']}/revisions/{author_revision['id']}/restore-to-workspace",
        headers=author_headers,
    )
    assert author_restore_response.status_code == 403, author_restore_response.text

    author_current_response = client.post(
        f"/api/v1/projects/{project['id']}/revisions/{author_revision['id']}/mark-current",
        headers=author_headers,
    )
    assert author_current_response.status_code == 403, author_current_response.text

    author_approve_response = client.post(
        f"/api/v1/projects/{project['id']}/revisions/{author_revision['id']}/approve",
        headers=author_headers,
    )
    assert author_approve_response.status_code == 403, author_approve_response.text

    author_reject_response = client.post(
        f"/api/v1/projects/{project['id']}/revisions/{author_revision['id']}/reject",
        headers=author_headers,
    )
    assert author_reject_response.status_code == 403, author_reject_response.text

    author_submit_response = client.post(
        f"/api/v1/projects/{project['id']}/revisions/{author_revision['id']}/submit",
        headers=author_headers,
    )
    assert author_submit_response.status_code == 200, author_submit_response.text

    proof_draft_response = client.post(
        f"/api/v1/projects/{project['id']}/revisions",
        json={"title": "Proof on draft", "comment": ""},
        headers=proof_headers,
    )
    assert proof_draft_response.status_code == 200, proof_draft_response.text

    proofreading_meta_response = client.put(
        f"/api/v1/projects/{project['id']}/meta",
        json={"status": "in_proofreading"},
        headers=editor_headers,
    )
    assert proofreading_meta_response.status_code == 200, proofreading_meta_response.text

    proof_revision_response = client.post(
        f"/api/v1/projects/{project['id']}/revisions",
        json={"title": "Корректорская версия", "comment": ""},
        headers=proof_headers,
    )
    assert proof_revision_response.status_code == 200, proof_revision_response.text
    proof_revision = proof_revision_response.json()["revision"]

    proof_restore_response = client.post(
        f"/api/v1/projects/{project['id']}/revisions/{proof_revision['id']}/restore-to-workspace",
        headers=proof_headers,
    )
    assert proof_restore_response.status_code == 403, proof_restore_response.text

    proof_current_response = client.post(
        f"/api/v1/projects/{project['id']}/revisions/{proof_revision['id']}/mark-current",
        headers=proof_headers,
    )
    assert proof_current_response.status_code == 403, proof_current_response.text

    proof_approve_response = client.post(
        f"/api/v1/projects/{project['id']}/revisions/{proof_revision['id']}/approve",
        headers=proof_headers,
    )
    assert proof_approve_response.status_code == 403, proof_approve_response.text

    proof_reject_response = client.post(
        f"/api/v1/projects/{project['id']}/revisions/{proof_revision['id']}/reject",
        headers=proof_headers,
    )
    assert proof_reject_response.status_code == 403, proof_reject_response.text

    editor_submit_response = client.post(
        f"/api/v1/projects/{project['id']}/revisions/{proof_revision['id']}/submit",
        headers=editor_headers,
    )
    assert editor_submit_response.status_code == 200, editor_submit_response.text

    editor_approve_response = client.post(
        f"/api/v1/projects/{project['id']}/revisions/{proof_revision['id']}/approve",
        headers=editor_headers,
    )
    assert editor_approve_response.status_code == 200, editor_approve_response.text

    editor_restore_response = client.post(
        f"/api/v1/projects/{project['id']}/revisions/{author_revision['id']}/restore-to-workspace",
        headers=editor_headers,
    )
    assert editor_restore_response.status_code == 200, editor_restore_response.text

    editor_current_response = client.post(
        f"/api/v1/projects/{project['id']}/revisions/{proof_revision['id']}/mark-current",
        headers=editor_headers,
    )
    assert editor_current_response.status_code == 200, editor_current_response.text


def test_revision_elements_endpoint_returns_editor_rows_shape(client) -> None:
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
                    "tc_in": "00:10",
                    "tc_out": "00:20",
                    "additional_comment": "цех",
                    "structured_data": {
                        "geo": "Уфа",
                        "text_lines": ["Первая строка", "Вторая строка"],
                    },
                    "formatting": {
                        "targets": {
                            "geo": {
                                "font_family": "PT Sans",
                                "bold": False,
                                "italic": True,
                                "strikethrough": False,
                                "fill_color": "#ffffff",
                            },
                            "text": {
                                "font_family": "PT Sans",
                                "bold": True,
                                "italic": False,
                                "strikethrough": False,
                                "fill_color": "#ffff00",
                            },
                        },
                        "html_by_target": {
                            "geo": "<em>Уфа</em>",
                            "text": "<strong>Первая строка</strong><br>Вторая строка",
                        },
                    },
                    "rich_text": {
                        "schema_version": 1,
                        "targets": {
                            "geo": {
                                "editor": "tiptap",
                                "text": "Уфа",
                                "html": "<em>Уфа</em>",
                                "doc": {"type": "doc", "content": []},
                            },
                            "text": {
                                "editor": "tiptap",
                                "text": "Первая строка\nВторая строка",
                                "html": "<strong>Первая строка</strong><br>Вторая строка",
                                "doc": {"type": "doc", "content": []},
                            },
                        },
                    },
                }
            ]
        },
        headers=headers,
    )
    assert save_response.status_code == 200, save_response.text
    saved_row = save_response.json()["elements"][0]

    revision = create_revision(client, headers, project["id"], title="Shape", comment="Rows payload")
    elements_response = client.get(
        f"/api/v1/projects/{project['id']}/revisions/{revision['id']}/elements",
        headers=headers,
    )
    assert elements_response.status_code == 200, elements_response.text
    revision_row = elements_response.json()["elements"][0]
    assert revision_row["segment_uid"] == saved_row["segment_uid"]
    assert revision_row["structured_data"]["geo"] == "Уфа"
    assert revision_row["formatting"]["targets"]["text"]["fill_color"] == "#ffff00"
    assert revision_row["rich_text"]["targets"]["text"]["editor"] == "tiptap"
