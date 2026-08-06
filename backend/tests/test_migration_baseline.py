from __future__ import annotations

import importlib
from pathlib import Path
from types import SimpleNamespace

from alembic import command
from alembic.config import Config
import pytest
from sqlalchemy import inspect, text

from app.db.base import Base
from app.db.models import Story
from app.db.session import engine


BACKEND_ROOT = Path(__file__).resolve().parents[1]
BASELINE_MIGRATION = BACKEND_ROOT / "migrations/versions/20260710_0001_product_reset.py"
USER_SESSIONS_MIGRATION = (
    BACKEND_ROOT / "migrations/versions/20260730_0002_user_sessions.py"
)
RUBRIC_NAME_KEY_MIGRATION = (
    BACKEND_ROOT / "migrations/versions/20260730_0003_rubric_name_key.py"
)
STORY_DURATION_TEXT_MIGRATION = (
    BACKEND_ROOT / "migrations/versions/20260806_0004_story_duration_text.py"
)
EXPECTED_TABLES = {
    "users",
    "user_sessions",
    "user_functions",
    "rubrics",
    "stories",
    "story_assignments",
    "story_material_links",
    "story_events",
    "scenarios",
    "scenario_rows",
    "scenario_edit_sessions",
    "scenario_revisions",
    "scenario_revision_rows",
    "story_workflow_states",
    "story_production_states",
    "scenario_read_markers",
    "correction_packages",
    "correction_parts",
    "external_approval_cycles",
    "notifications",
}


def _alembic_config() -> Config:
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", str(engine.url))
    return config


def test_product_reset_keeps_baseline_and_forward_invariant_migrations() -> None:
    migrations = sorted((BACKEND_ROOT / "migrations/versions").glob("*.py"))

    assert migrations == [
        BASELINE_MIGRATION,
        USER_SESSIONS_MIGRATION,
        RUBRIC_NAME_KEY_MIGRATION,
        STORY_DURATION_TEXT_MIGRATION,
    ]
    baseline_source = BASELINE_MIGRATION.read_text(encoding="utf-8")
    forward_source = USER_SESSIONS_MIGRATION.read_text(encoding="utf-8")
    rubric_forward_source = RUBRIC_NAME_KEY_MIGRATION.read_text(encoding="utf-8")
    duration_forward_source = STORY_DURATION_TEXT_MIGRATION.read_text(encoding="utf-8")
    assert 'revision = "20260710_0001"' in baseline_source
    assert "down_revision = None" in baseline_source
    assert 'revision = "20260730_0002"' in forward_source
    assert 'down_revision = "20260710_0001"' in forward_source
    assert 'revision = "20260730_0003"' in rubric_forward_source
    assert 'down_revision = "20260730_0002"' in rubric_forward_source
    assert 'revision = "20260806_0004"' in duration_forward_source
    assert 'down_revision = "20260730_0003"' in duration_forward_source


def test_story_duration_text_migration_upgrades_and_downgrades_only_its_column() -> None:
    config = _alembic_config()
    command.downgrade(config, "base")
    command.upgrade(config, "20260806_0004")

    duration_column = next(
        column
        for column in inspect(engine).get_columns("stories")
        if column["name"] == "duration_text"
    )
    assert duration_column["nullable"] is True

    command.downgrade(config, "20260730_0003")
    story_columns = {column["name"] for column in inspect(engine).get_columns("stories")}
    rubric_columns = {column["name"] for column in inspect(engine).get_columns("rubrics")}
    assert "duration_text" not in story_columns
    assert "name_key" in rubric_columns


def test_rubric_name_key_migration_backfills_without_losing_existing_rows() -> None:
    config = _alembic_config()
    command.downgrade(config, "20260730_0002")
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO rubrics "
                "(id, name, is_active, created_at, updated_at) "
                "VALUES "
                "(7001, '  Синтетическая   Рубрика  ', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP), "
                "(7002, 'Другая рубрика', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            )
        )

    command.upgrade(config, "head")

    with engine.connect() as connection:
        rows = connection.execute(
            text("SELECT id, name, name_key, is_active FROM rubrics ORDER BY id")
        ).mappings().all()
    assert rows == [
        {
            "id": 7001,
            "name": "  Синтетическая   Рубрика  ",
            "name_key": "синтетическая рубрика",
            "is_active": True,
        },
        {
            "id": 7002,
            "name": "Другая рубрика",
            "name_key": "другая рубрика",
            "is_active": False,
        },
    ]


def test_rubric_name_key_migration_locks_postgresql_table_before_reading_rows(
    monkeypatch,
) -> None:
    migration = importlib.import_module(
        "migrations.versions.20260730_0003_rubric_name_key"
    )

    class EmptyRows:
        def mappings(self):
            return self

        def all(self) -> list[object]:
            return []

    class PostgreSQLConnection:
        dialect = SimpleNamespace(name="postgresql")

        def __init__(self) -> None:
            self.statements: list[str] = []

        def execute(self, statement, _params=None) -> EmptyRows:
            self.statements.append(str(statement))
            return EmptyRows()

    connection = PostgreSQLConnection()
    monkeypatch.setattr(migration.op, "get_bind", lambda: connection)
    monkeypatch.setattr(migration.op, "add_column", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(migration.op, "create_index", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(migration.op, "alter_column", lambda *_args, **_kwargs: None)

    migration.upgrade()

    assert connection.statements[:2] == [
        "LOCK TABLE rubrics IN ACCESS EXCLUSIVE MODE",
        "SELECT id, name FROM rubrics ORDER BY id",
    ]


def test_model_metadata_defines_exact_target_table_set() -> None:
    assert set(Base.metadata.tables) == EXPECTED_TABLES


def test_story_model_defines_nullable_bounded_duration_text() -> None:
    assert Story.__table__.c.duration_text.type.length == 64
    assert Story.__table__.c.duration_text.nullable is True


def test_baseline_contains_required_domain_constraints_and_partial_indexes() -> None:
    source = BASELINE_MIGRATION.read_text(encoding="utf-8")
    required_names = {
        "ck_user_functions_code",
        "ck_stories_priority",
        "ck_stories_archive_after_air",
        "ck_story_assignments_kind",
        "ck_scenario_read_markers_context",
        "ck_correction_packages_source",
        "ck_correction_parts_scope",
        "ck_correction_parts_state",
        "ck_external_approval_result",
        "uq_story_assignment_kind",
        "uq_scenario_active_edit_session",
        "uq_external_approval_pending_story",
        "ix_notifications_unread_recipient",
        "ix_user_functions_function_code_user_id",
        "ix_stories_queue",
        "ix_story_events_story_created_desc",
        "ix_scenario_edit_sessions_story_started_desc",
        "ix_correction_parts_assignee_state",
        "ix_correction_packages_open_story",
    }
    assert {name for name in required_names if name not in source} == set()
    assert "postgresql.JSONB" in source
    assert "postgresql_where" in source


@pytest.mark.skipif(
    engine.dialect.name != "postgresql",
    reason="PostgreSQL inspector проверяет sort order и partial predicates",
)
def test_postgresql_composite_index_contract() -> None:
    db_inspector = inspect(engine)
    expected_columns = {
        "ix_user_functions_function_code_user_id": (
            "user_functions",
            ["function_code", "user_id"],
        ),
        "ix_stories_queue": (
            "stories",
            ["archived_at", "priority", "created_at", "id"],
        ),
        "ix_story_events_story_created_desc": (
            "story_events",
            ["story_id", "created_at", "id"],
        ),
        "ix_scenario_edit_sessions_story_started_desc": (
            "scenario_edit_sessions",
            ["scenario_id", "started_at", "id"],
        ),
        "ix_correction_parts_assignee_state": (
            "correction_parts",
            ["assignee_user_id", "state"],
        ),
        "ix_correction_packages_open_story": (
            "correction_packages",
            ["story_id"],
        ),
    }
    found = {
        item["name"]: item
        for table_name, _columns in expected_columns.values()
        for item in db_inspector.get_indexes(table_name)
    }
    for name, (_table_name, columns) in expected_columns.items():
        assert found[name]["column_names"] == columns

    assert found["ix_stories_queue"]["column_sorting"] == {
        "created_at": ("desc",),
        "id": ("desc",),
    }
    assert found["ix_story_events_story_created_desc"]["column_sorting"] == {
        "created_at": ("desc",),
        "id": ("desc",),
    }
    assert found["ix_scenario_edit_sessions_story_started_desc"]["column_sorting"] == {
        "started_at": ("desc",),
        "id": ("desc",),
    }
    predicate = str(
        found["ix_correction_packages_open_story"]["dialect_options"]["postgresql_where"]
    )
    assert predicate == "(closed_at IS NULL)"


def test_baseline_upgrades_empty_database_and_downgrades_cleanly() -> None:
    config = _alembic_config()
    command.downgrade(config, "base")
    assert set(inspect(engine).get_table_names()) <= {"alembic_version"}

    command.upgrade(config, "head")
    assert set(inspect(engine).get_table_names()) == EXPECTED_TABLES | {"alembic_version"}
    command.upgrade(config, "head")

    db_inspector = inspect(engine)
    assert {item["name"] for item in db_inspector.get_check_constraints("user_functions")} == {
        "ck_user_functions_code"
    }
    assert "uq_scenario_active_edit_session" in {
        item["name"] for item in db_inspector.get_indexes("scenario_edit_sessions")
    }
    assert "uq_external_approval_pending_story" in {
        item["name"] for item in db_inspector.get_indexes("external_approval_cycles")
    }

    for table_name in EXPECTED_TABLES:
        assert {column["name"] for column in db_inspector.get_columns(table_name)} == {
            column.name for column in Base.metadata.tables[table_name].columns
        }

    command.downgrade(config, "base")
    assert set(inspect(engine).get_table_names()) <= {"alembic_version"}
