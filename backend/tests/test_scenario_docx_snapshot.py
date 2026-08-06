from __future__ import annotations

from dataclasses import FrozenInstanceError

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import event, func, select

from app.db.models import (
    Rubric,
    Scenario,
    ScenarioRow,
    Story,
    StoryEvent,
    StoryProductionState,
    StoryWorkflowState,
    User,
)
from app.db.session import SessionLocal, engine
from app.schemas.scenario_export import ScenarioDocxExportRequest
from app.services.scenario_docx_snapshot import DocxFileBundle, build_scenario_docx_snapshot
from tests.sql_lock_order import AGGREGATE_TABLES, capture_sql


def _create_story_with_rows() -> tuple[int, int]:
    with SessionLocal() as db:
        author = User(
            username="docx-snapshot-author",
            display_name="Тестовый автор",
            position="Корреспондент",
            password_hash="synthetic-test-hash",
            is_active=True,
            must_change_password=False,
        )
        rubric = Rubric(name="Синтетическая рубрика", is_active=True)
        db.add_all([author, rubric])
        db.flush()
        story = Story(
            title="Синтетический сюжет",
            rubric_id=rubric.id,
            author_user_id=author.id,
            duration_text="05:30",
        )
        db.add(story)
        db.flush()
        scenario = Scenario(story_id=story.id, revision_no=7)
        db.add_all(
            [
                scenario,
                StoryWorkflowState(story_id=story.id),
                StoryProductionState(story_id=story.id),
            ]
        )
        db.flush()
        db.add(
            ScenarioRow(
                scenario_id=scenario.id,
                segment_uid="seg-synthetic-second",
                order_index=20,
                block_type="snh",
                text="Вторая строка",
                speaker_text="Тестовый спикер",
                file_name=" legacy-second.mov ",
                tc_in=" 00:20 ",
                tc_out=" 00:25 ",
                additional_comment="Комментарий второй строки",
                structured_data={"nested": {"items": [{"value": "second"}]}},
                formatting={"text": {"bold": False}},
                rich_text={"targets": {"text": {"text": "Вторая строка"}}},
            )
        )
        db.flush()
        db.add(
            ScenarioRow(
                scenario_id=scenario.id,
                segment_uid="seg-synthetic-first",
                order_index=10,
                block_type="zk",
                text="Первая строка",
                speaker_text="",
                file_name="ignored-legacy.mov",
                tc_in="99:01",
                tc_out="99:05",
                additional_comment="Комментарий первой строки",
                structured_data={
                    "file_bundles": [
                        {
                            "file_name": " primary.mov ",
                            "tc_in": " 00:01 ",
                            "tc_out": "00:05 ",
                        },
                        None,
                        "invalid",
                        {"file_name": 17, "tc_in": [], "tc_out": {}},
                        {"file_name": "", "tc_in": " 00:06 ", "tc_out": ""},
                        {"file_name": " ", "tc_in": " ", "tc_out": " "},
                    ],
                    "nested": {"items": [{"value": "first"}]},
                },
                formatting={"text": {"bold": True, "levels": [1, {"deep": "yes"}]}},
                rich_text={
                    "targets": {
                        "text": {
                            "doc": {
                                "type": "doc",
                                "content": [{"type": "paragraph"}],
                            }
                        }
                    }
                },
            )
        )
        foreign_story = Story(
            title="Другой синтетический сюжет",
            rubric_id=rubric.id,
            author_user_id=author.id,
            duration_text="01:00",
        )
        db.add(foreign_story)
        db.flush()
        foreign_scenario = Scenario(story_id=foreign_story.id, revision_no=3)
        db.add_all(
            [
                foreign_scenario,
                StoryWorkflowState(story_id=foreign_story.id),
                StoryProductionState(story_id=foreign_story.id),
            ]
        )
        db.flush()
        db.add(
            ScenarioRow(
                scenario_id=foreign_scenario.id,
                segment_uid="seg-synthetic-foreign",
                order_index=5,
                block_type="zk",
                text="Строка чужого сценария",
            )
        )
        db.commit()
        return story.id, rubric.id


def _matching_request(rubric_id: int) -> ScenarioDocxExportRequest:
    return ScenarioDocxExportRequest(
        expected_revision=7,
        expected_title="Синтетический сюжет",
        expected_rubric_id=rubric_id,
        expected_duration_text="05:30",
    )


def test_export_request_normalizes_title_and_optional_duration_exactly() -> None:
    request = ScenarioDocxExportRequest(
        expected_revision=0,
        expected_title=" Первая\r\nВторая\nТретья ",
        expected_rubric_id=None,
        expected_duration_text="  до 5 минут  ",
    )
    blank_duration = ScenarioDocxExportRequest(
        expected_revision=0,
        expected_title="Заголовок",
        expected_duration_text=" \t\n ",
    )

    assert request.expected_title == "Первая  Вторая Третья"
    assert request.expected_duration_text == "до 5 минут"
    assert blank_duration.expected_duration_text is None

    with pytest.raises(ValidationError, match="expected_title не может быть пустым"):
        ScenarioDocxExportRequest(expected_revision=0, expected_title="\r\n")


def test_snapshot_reads_locked_aggregate_and_ordered_rows_in_one_transaction() -> None:
    story_id, rubric_id = _create_story_with_rows()
    started_transactions: list[object] = []
    committed_transactions: list[bool] = []

    with SessionLocal() as db:
        event.listen(
            db,
            "after_begin",
            lambda _session, transaction, _connection: started_transactions.append(transaction),
        )
        event.listen(db, "after_commit", lambda _session: committed_transactions.append(True))
        result = None

        def build() -> None:
            nonlocal result
            result = build_scenario_docx_snapshot(
                db,
                story_id=story_id,
                expected=_matching_request(rubric_id),
            )

        statements = capture_sql(engine, build)

        assert result is not None
        assert result.story_id == story_id
        assert result.title == "Синтетический сюжет"
        assert result.rubric_id == rubric_id
        assert result.rubric_name == "Синтетическая рубрика"
        assert result.duration_text == "05:30"
        assert result.revision == 7
        assert [row.text for row in result.rows] == ["Первая строка", "Вторая строка"]

        aggregate_locks = [
            (index, statement.target_tables[0])
            for index, statement in enumerate(statements)
            if statement.for_update
            and len(statement.target_tables) == 1
            and statement.target_tables[0] in AGGREGATE_TABLES
        ]
        assert [table for _index, table in aggregate_locks] == list(AGGREGATE_TABLES)
        aggregate_complete = aggregate_locks[-1][0]
        rubric_read = next(
            index
            for index, statement in enumerate(statements)
            if statement.target_tables == ("rubrics",)
        )
        row_read_index, row_read = next(
            (index, statement)
            for index, statement in enumerate(statements)
            if statement.target_tables == ("scenario_rows",)
        )
        assert aggregate_complete < rubric_read < row_read_index
        assert "order by scenario_rows.order_index asc, scenario_rows.id asc" in row_read.sql
        assert len(started_transactions) == 1
        assert started_transactions[0] is db.get_transaction()
        assert db.in_transaction()
        assert committed_transactions == []
        assert db.scalar(select(func.count()).select_from(StoryEvent)) == 0
        assert not any(statement.mutation_target_tables for statement in statements)


def test_snapshot_prefers_valid_file_bundles_and_uses_legacy_only_without_array() -> None:
    story_id, rubric_id = _create_story_with_rows()

    with SessionLocal() as db:
        snapshot = build_scenario_docx_snapshot(
            db,
            story_id=story_id,
            expected=_matching_request(rubric_id),
        )

    assert snapshot.rows[0].file_bundles == (
        DocxFileBundle(
            file_name="primary.mov",
            tc_in="00:01",
            tc_out="00:05",
        ),
        DocxFileBundle(
            file_name="",
            tc_in="00:06",
            tc_out="",
        ),
    )
    assert snapshot.rows[1].file_bundles == (
        DocxFileBundle(
            file_name="legacy-second.mov",
            tc_in="00:20",
            tc_out="00:25",
        ),
    )


def test_snapshot_excludes_rows_from_other_scenarios() -> None:
    story_id, rubric_id = _create_story_with_rows()

    with SessionLocal() as db:
        snapshot = build_scenario_docx_snapshot(
            db,
            story_id=story_id,
            expected=_matching_request(rubric_id),
        )

    assert tuple(row.text for row in snapshot.rows) == ("Первая строка", "Вторая строка")


def test_snapshot_leaves_session_unit_of_work_unchanged() -> None:
    story_id, rubric_id = _create_story_with_rows()

    with SessionLocal() as db:
        snapshot = build_scenario_docx_snapshot(
            db,
            story_id=story_id,
            expected=_matching_request(rubric_id),
        )

        assert not db.new
        assert not db.dirty
        assert not db.deleted
        assert snapshot.story_id == story_id


def test_snapshot_deep_copies_and_freezes_every_nested_json_mapping() -> None:
    story_id, rubric_id = _create_story_with_rows()

    with SessionLocal() as db:
        source_row = db.scalar(
            select(ScenarioRow)
            .join(Scenario, Scenario.id == ScenarioRow.scenario_id)
            .where(Scenario.story_id == story_id)
            .order_by(ScenarioRow.order_index.asc())
        )
        assert source_row is not None
        snapshot = build_scenario_docx_snapshot(
            db,
            story_id=story_id,
            expected=_matching_request(rubric_id),
        )
        source_row.structured_data["nested"]["items"][0]["value"] = "source-mutated"
        source_row.formatting["text"]["levels"][1]["deep"] = "source-mutated"
        source_row.rich_text["targets"]["text"]["doc"]["content"][0]["type"] = (
            "source-mutated"
        )

    row = snapshot.rows[0]
    assert row.structured_data["nested"]["items"][0]["value"] == "first"
    assert row.formatting["text"]["levels"][1]["deep"] == "yes"
    assert row.rich_text["targets"]["text"]["doc"]["content"][0]["type"] == "paragraph"

    with pytest.raises(TypeError):
        row.structured_data["nested"]["items"][0]["value"] = "mutated"
    with pytest.raises(TypeError):
        row.formatting["text"]["levels"][1]["deep"] = "mutated"
    with pytest.raises(TypeError):
        row.rich_text["targets"]["text"]["doc"]["content"][0]["type"] = "mutated"
    with pytest.raises(AttributeError):
        row.formatting["text"]["levels"].append(2)
    with pytest.raises(FrozenInstanceError):
        row.text = "mutated"
    assert not hasattr(snapshot, "story")
    assert not hasattr(snapshot, "scenario")


@pytest.mark.parametrize(
    ("overrides",),
    [
        ({"expected_revision": 6},),
        ({"expected_title": "Другой сюжет"},),
        ({"expected_rubric_id": None},),
        ({"expected_duration_text": None},),
    ],
    ids=["revision", "title", "rubric_id", "duration_text"],
)
def test_snapshot_rejects_each_stale_expectation_with_exact_conflict(overrides: dict[str, object]) -> None:
    story_id, rubric_id = _create_story_with_rows()
    values: dict[str, object] = {
        "expected_revision": 7,
        "expected_title": "Синтетический сюжет",
        "expected_rubric_id": rubric_id,
        "expected_duration_text": "05:30",
    }
    values.update(overrides)

    with SessionLocal() as db, pytest.raises(HTTPException) as raised:
        build_scenario_docx_snapshot(
            db,
            story_id=story_id,
            expected=ScenarioDocxExportRequest(**values),
        )

    assert raised.value.status_code == 409
    assert raised.value.detail == {
        "code": "EXPORT_SNAPSHOT_MISMATCH",
        "message": "Сюжет изменился. Обновите карточку и повторите экспорт.",
    }


def test_snapshot_preserves_existing_story_not_found_error() -> None:
    with SessionLocal() as db, pytest.raises(HTTPException) as raised:
        build_scenario_docx_snapshot(
            db,
            story_id=404_404,
            expected=ScenarioDocxExportRequest(
                expected_revision=0,
                expected_title="Несуществующий синтетический сюжет",
            ),
        )

    assert raised.value.status_code == 404
    assert raised.value.detail == {"code": "STORY_NOT_FOUND", "message": "Сюжет не найден"}
