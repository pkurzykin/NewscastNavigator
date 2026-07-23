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
    mutation_target_tables: tuple[str, ...] = ()

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


def _mutation_target_tables(statement) -> tuple[str, ...]:
    if statement is None or not any(
        getattr(statement, attribute, False)
        for attribute in ("is_insert", "is_update", "is_delete")
    ):
        return ()
    table_name = getattr(getattr(statement, "table", None), "name", None)
    return (table_name.lower(),) if isinstance(table_name, str) else ()


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
            mutation_target_tables=_mutation_target_tables(compiled_statement),
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
        mutation_target_tables=_mutation_target_tables(compiled_statement),
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


def _assert_no_mixed_tracked_locks(statements: list[SqlTraceStatement]) -> None:
    tracked_tables = set((*AGGREGATE_TABLES, SESSION_TABLE))
    for statement in statements:
        tracked_targets = tracked_tables.intersection(statement.target_tables)
        assert not (
            statement.for_update
            and len(statement.target_tables) > 1
            and tracked_targets
        ), (
            "Tracked table appeared in a mixed-target FOR UPDATE: "
            f"{statement.sql}"
        )


def assert_aggregate_lock_order(statements: list[SqlTraceStatement]) -> None:
    _assert_no_mixed_tracked_locks(statements)

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


def assert_exact_aggregate_locks_before_mutation(
    statements: list[SqlTraceStatement],
    *,
    mutation_tables: tuple[str, ...],
) -> None:
    _assert_no_mixed_tracked_locks(statements)
    aggregate_locks = [
        (index, statement.target_tables[0])
        for index, statement in enumerate(statements)
        if statement.for_update
        and len(statement.target_tables) == 1
        and statement.target_tables[0] in AGGREGATE_TABLES
    ]
    assert [table for _index, table in aggregate_locks] == list(AGGREGATE_TABLES), (
        "Aggregate FOR UPDATE sequence must be exactly "
        "Story -> Scenario -> Workflow -> Production"
    )

    mutation_table_set = set(mutation_tables)
    mutation_positions = [
        index
        for index, statement in enumerate(statements)
        if mutation_table_set.intersection(statement.mutation_target_tables)
    ]
    assert mutation_positions, (
        "Missing required mutation barrier for "
        f"{sorted(mutation_table_set)}"
    )
    assert aggregate_locks[-1][0] < mutation_positions[0], (
        "Tracked mutation occurred before aggregate locks completed"
    )
