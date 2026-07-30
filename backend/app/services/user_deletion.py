from __future__ import annotations

from sqlalchemy import literal, select
from sqlalchemy.orm import Session

from app.db.base import Base


NON_BLOCKING_USER_REFERENCES = frozenset({
    ("user_functions", "user_id"),
    ("user_sessions", "user_id"),
    ("scenario_read_markers", "user_id"),
    ("notifications", "recipient_user_id"),
})


def find_user_deletion_blockers(
    db: Session,
    *,
    user_id: int,
) -> tuple[str, ...]:
    blockers: list[str] = []
    for table in sorted(Base.metadata.tables.values(), key=lambda item: item.name):
        for foreign_key in sorted(
            table.foreign_keys,
            key=lambda item: item.parent.name,
        ):
            if (
                foreign_key.column.table.name != "users"
                or foreign_key.column.name != "id"
            ):
                continue
            reference = (table.name, foreign_key.parent.name)
            if reference in NON_BLOCKING_USER_REFERENCES:
                continue
            exists = db.scalar(
                select(literal(True))
                .select_from(table)
                .where(foreign_key.parent == user_id)
                .limit(1)
            )
            if exists:
                blockers.append(".".join(reference))
    return tuple(blockers)
