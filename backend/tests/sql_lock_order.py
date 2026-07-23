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
    target_tables: tuple[str, ...] = ()

    @classmethod
    def locked_table(cls, table: str) -> SqlTraceStatement:
        return cls(
            sql=f"select * from {table} for update",
            for_update=True,
            target_tables=(table,),
        )


def _normalized(value: str) -> str:
    return " ".join(value.lower().split())


def _outer_target_tables(statement) -> tuple[str, ...]:
    get_final_froms = getattr(statement, "get_final_froms", None)
    if get_final_froms is None:
        return ()

    def names(from_clause) -> list[str]:
        name = getattr(from_clause, "name", None)
        if isinstance(name, str):
            return [name.lower()]
        result: list[str] = []
        for attribute in ("left", "right"):
            nested = getattr(from_clause, attribute, None)
            if nested is not None:
                result.extend(names(nested))
        return result

    result: list[str] = []
    for from_clause in get_final_froms():
        result.extend(names(from_clause))
    return tuple(dict.fromkeys(result))


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
        return SqlTraceStatement(
            sql=_normalized(raw_sql),
            for_update=False,
            target_tables=_outer_target_tables(compiled_statement),
        )
    postgresql_sql = str(
        compiled_statement.compile(dialect=postgresql.dialect())
    )
    assert "FOR UPDATE" in postgresql_sql.upper(), (
        "SQLAlchemy statement was annotated as FOR UPDATE but PostgreSQL "
        "compilation omitted the row lock"
    )
    return SqlTraceStatement(
        sql=_normalized(postgresql_sql),
        for_update=True,
        target_tables=_outer_target_tables(compiled_statement),
    )


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
        return [
            index
            for index, statement in enumerate(statements)
            if statement.for_update and statement.target_tables == (table,)
        ]

    aggregate_positions: list[int] = []
    for table in AGGREGATE_TABLES:
        positions = lock_positions(table)
        assert positions, f"Missing required {table} FOR UPDATE"
        aggregate_positions.append(positions[0])
    assert (
        aggregate_positions[0]
        < aggregate_positions[1]
        < aggregate_positions[2]
        < aggregate_positions[3]
    ), (
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
        and set(statement.target_tables).intersection(AGGREGATE_TABLES)
    ]
    assert not late_aggregate_locks, (
        "Aggregate FOR UPDATE occurred after ScenarioEditSession lock: "
        f"{late_aggregate_locks}"
    )
