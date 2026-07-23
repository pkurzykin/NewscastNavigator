from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from sqlalchemy import event
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Engine


AGGREGATE_TABLES = (
    "stories",
    "scenarios",
    "story_workflow_states",
    "story_production_states",
)
SESSION_TABLE = "scenario_edit_sessions"


@dataclass(frozen=True)
class SqlTraceStatement:
    sql: str
    for_update: bool


def _normalized(value: str) -> str:
    return " ".join(value.lower().split())


def _trace_statement(raw_sql: str, context) -> SqlTraceStatement:
    compiled_statement = getattr(
        getattr(context, "compiled", None),
        "statement",
        None,
    )
    for_update = (
        compiled_statement is not None
        and getattr(compiled_statement, "_for_update_arg", None) is not None
    )
    if not for_update:
        return SqlTraceStatement(sql=_normalized(raw_sql), for_update=False)
    postgresql_sql = str(
        compiled_statement.compile(dialect=postgresql.dialect())
    )
    assert "FOR UPDATE" in postgresql_sql.upper(), (
        "SQLAlchemy statement was annotated as FOR UPDATE but PostgreSQL "
        "compilation omitted the row lock"
    )
    return SqlTraceStatement(sql=_normalized(postgresql_sql), for_update=True)


def capture_sql(engine: Engine, action: Callable[[], None]) -> list[SqlTraceStatement]:
    statements: list[SqlTraceStatement] = []

    def capture(_connection, _cursor, statement, _parameters, context, _executemany):
        statements.append(_trace_statement(statement, context))

    event.listen(engine, "before_cursor_execute", capture)
    try:
        action()
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    return statements


def assert_aggregate_lock_order(statements: list[SqlTraceStatement]) -> None:
    def lock_positions(table: str) -> list[int]:
        marker = f"from {table}"
        return [
            index
            for index, statement in enumerate(statements)
            if statement.for_update and marker in statement.sql
        ]

    aggregate_positions: list[int] = []
    for table in AGGREGATE_TABLES:
        positions = lock_positions(table)
        assert positions, f"Missing required {table} FOR UPDATE"
        aggregate_positions.append(positions[0])
    assert aggregate_positions == sorted(aggregate_positions), (
        "Aggregate FOR UPDATE order must be "
        "Story -> Scenario -> Workflow -> Production"
    )

    session_positions = lock_positions(SESSION_TABLE)
    assert session_positions, "Missing required ScenarioEditSession FOR UPDATE"
    first_session = session_positions[0]
    assert aggregate_positions[-1] < first_session, (
        "ScenarioEditSession FOR UPDATE occurred before the aggregate was locked"
    )

    late_aggregate_locks = [
        statement.sql
        for statement in statements[first_session + 1 :]
        if statement.for_update
        and any(f"from {table}" in statement.sql for table in AGGREGATE_TABLES)
    ]
    assert not late_aggregate_locks, (
        "Aggregate FOR UPDATE occurred after ScenarioEditSession lock: "
        f"{late_aggregate_locks}"
    )
