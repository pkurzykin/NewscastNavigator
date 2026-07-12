from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
import pytest
from sqlalchemy import inspect

from app.db.base import Base
from app.db.session import engine


BACKEND_ROOT = Path(__file__).resolve().parents[1]
MIGRATION = BACKEND_ROOT / "migrations/versions/20260710_0001_product_reset.py"
EXPECTED_TABLES = {
    "users",
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


def test_product_reset_has_one_baseline_migration() -> None:
    migrations = sorted((BACKEND_ROOT / "migrations/versions").glob("*.py"))

    assert migrations == [MIGRATION]
    source = MIGRATION.read_text(encoding="utf-8")
    assert 'revision = "20260710_0001"' in source
    assert "down_revision = None" in source


def test_model_metadata_defines_exact_target_table_set() -> None:
    assert set(Base.metadata.tables) == EXPECTED_TABLES


def test_baseline_contains_required_domain_constraints_and_partial_indexes() -> None:
    source = MIGRATION.read_text(encoding="utf-8")
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
