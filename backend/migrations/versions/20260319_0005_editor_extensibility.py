"""add editor extensibility fields

Revision ID: 20260319_0005
Revises: 20260315_0004
Create Date: 2026-03-19 23:10:00.000000
"""

from alembic import op
import sqlalchemy as sa
import json


revision = "20260319_0005"
down_revision = "20260315_0004"
branch_labels = None
depends_on = None


def _table_exists(table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table_name in inspector.get_table_names()


def _column_exists(table_name: str, column_name: str) -> bool:
    if not _table_exists(table_name):
        return False
    inspector = sa.inspect(op.get_bind())
    return any(col.get("name") == column_name for col in inspector.get_columns(table_name))


def _is_sqlite() -> bool:
    return op.get_bind().dialect.name == "sqlite"


def _upgrade_projects_sqlite() -> None:
    file_roots_exists = _column_exists("projects", "project_file_roots_json")
    executor_ids_exists = _column_exists("projects", "executor_user_ids_json")

    with op.batch_alter_table("projects", recreate="always") as batch_op:
        if not file_roots_exists:
            batch_op.add_column(sa.Column("project_file_roots_json", sa.Text(), nullable=True))
        if not executor_ids_exists:
            batch_op.add_column(sa.Column("executor_user_ids_json", sa.Text(), nullable=True))


def _upgrade_script_elements_sqlite() -> None:
    content_exists = _column_exists("script_elements", "content_json")
    formatting_exists = _column_exists("script_elements", "formatting_json")

    with op.batch_alter_table("script_elements", recreate="always") as batch_op:
        if not content_exists:
            batch_op.add_column(sa.Column("content_json", sa.Text(), nullable=True))
        if not formatting_exists:
            batch_op.add_column(sa.Column("formatting_json", sa.Text(), nullable=True))


def _downgrade_projects_sqlite() -> None:
    file_roots_exists = _column_exists("projects", "project_file_roots_json")
    executor_ids_exists = _column_exists("projects", "executor_user_ids_json")

    with op.batch_alter_table("projects", recreate="always") as batch_op:
        if executor_ids_exists:
            batch_op.drop_column("executor_user_ids_json")
        if file_roots_exists:
            batch_op.drop_column("project_file_roots_json")


def _downgrade_script_elements_sqlite() -> None:
    content_exists = _column_exists("script_elements", "content_json")
    formatting_exists = _column_exists("script_elements", "formatting_json")

    with op.batch_alter_table("script_elements", recreate="always") as batch_op:
        if formatting_exists:
            batch_op.drop_column("formatting_json")
        if content_exists:
            batch_op.drop_column("content_json")


def upgrade() -> None:
    bind = op.get_bind()

    if _table_exists("projects"):
        if _is_sqlite():
            _upgrade_projects_sqlite()
        else:
            if not _column_exists("projects", "project_file_roots_json"):
                op.add_column("projects", sa.Column("project_file_roots_json", sa.Text(), nullable=True))
            if not _column_exists("projects", "executor_user_ids_json"):
                op.add_column("projects", sa.Column("executor_user_ids_json", sa.Text(), nullable=True))

        projects_table = sa.table(
            "projects",
            sa.column("id", sa.Integer()),
            sa.column("project_file_root", sa.Text()),
            sa.column("project_file_roots_json", sa.Text()),
            sa.column("executor_user_id", sa.Integer()),
            sa.column("executor_user_ids_json", sa.Text()),
        )
        rows = bind.execute(
            sa.select(
                projects_table.c.id,
                projects_table.c.project_file_root,
                projects_table.c.project_file_roots_json,
                projects_table.c.executor_user_id,
                projects_table.c.executor_user_ids_json,
            )
        ).all()
        for row in rows:
            updates: dict[str, str | None] = {}
            file_root = (row.project_file_root or "").strip()
            if row.project_file_roots_json is None and file_root:
                updates["project_file_roots_json"] = json.dumps([file_root], ensure_ascii=False)
            if row.executor_user_ids_json is None and row.executor_user_id:
                updates["executor_user_ids_json"] = json.dumps(
                    [int(row.executor_user_id)],
                    ensure_ascii=False,
                )
            if updates:
                bind.execute(
                    sa.update(projects_table)
                    .where(projects_table.c.id == row.id)
                    .values(**updates)
                )

    if _table_exists("script_elements"):
        if _is_sqlite():
            _upgrade_script_elements_sqlite()
        else:
            if not _column_exists("script_elements", "content_json"):
                op.add_column("script_elements", sa.Column("content_json", sa.Text(), nullable=True))
            if not _column_exists("script_elements", "formatting_json"):
                op.add_column("script_elements", sa.Column("formatting_json", sa.Text(), nullable=True))


def downgrade() -> None:
    if _table_exists("script_elements"):
        if _is_sqlite():
            _downgrade_script_elements_sqlite()
        else:
            if _column_exists("script_elements", "formatting_json"):
                op.drop_column("script_elements", "formatting_json")
            if _column_exists("script_elements", "content_json"):
                op.drop_column("script_elements", "content_json")

    if _table_exists("projects"):
        if _is_sqlite():
            _downgrade_projects_sqlite()
        else:
            if _column_exists("projects", "executor_user_ids_json"):
                op.drop_column("projects", "executor_user_ids_json")
            if _column_exists("projects", "project_file_roots_json"):
                op.drop_column("projects", "project_file_roots_json")
