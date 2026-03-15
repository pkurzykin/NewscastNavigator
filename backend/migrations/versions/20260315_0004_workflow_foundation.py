"""add workflow foundation fields and project events

Revision ID: 20260315_0004
Revises: 20260217_0003
Create Date: 2026-03-15 18:10:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "20260315_0004"
down_revision = "20260217_0003"
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


def _index_exists(table_name: str, index_name: str) -> bool:
    if not _table_exists(table_name):
        return False
    inspector = sa.inspect(op.get_bind())
    return any(index.get("name") == index_name for index in inspector.get_indexes(table_name))


def _foreign_key_exists(table_name: str, fk_name: str) -> bool:
    if not _table_exists(table_name):
        return False
    inspector = sa.inspect(op.get_bind())
    return any(fk.get("name") == fk_name for fk in inspector.get_foreign_keys(table_name))


def upgrade() -> None:
    if _table_exists("projects") and not _column_exists("projects", "source_project_id"):
        op.add_column("projects", sa.Column("source_project_id", sa.Integer(), nullable=True))
    if _table_exists("projects") and not _column_exists("projects", "executor_user_id"):
        op.add_column("projects", sa.Column("executor_user_id", sa.Integer(), nullable=True))
    if _table_exists("projects") and not _column_exists("projects", "proofreader_user_id"):
        op.add_column("projects", sa.Column("proofreader_user_id", sa.Integer(), nullable=True))
    if _table_exists("projects") and not _column_exists("projects", "archived_at"):
        op.add_column("projects", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
    if _table_exists("projects") and not _column_exists("projects", "archived_by"):
        op.add_column("projects", sa.Column("archived_by", sa.Integer(), nullable=True))
    if _table_exists("projects") and not _column_exists("projects", "status_changed_at"):
        op.add_column("projects", sa.Column("status_changed_at", sa.DateTime(timezone=True), nullable=True))
    if _table_exists("projects") and not _column_exists("projects", "status_changed_by"):
        op.add_column("projects", sa.Column("status_changed_by", sa.Integer(), nullable=True))

    if _table_exists("projects") and not _foreign_key_exists("projects", "fk_projects_source_project_id_projects"):
        op.create_foreign_key(
            "fk_projects_source_project_id_projects",
            "projects",
            "projects",
            ["source_project_id"],
            ["id"],
            ondelete="SET NULL",
        )
    if _table_exists("projects") and not _foreign_key_exists("projects", "fk_projects_executor_user_id_users"):
        op.create_foreign_key(
            "fk_projects_executor_user_id_users",
            "projects",
            "users",
            ["executor_user_id"],
            ["id"],
            ondelete="SET NULL",
        )
    if _table_exists("projects") and not _foreign_key_exists("projects", "fk_projects_proofreader_user_id_users"):
        op.create_foreign_key(
            "fk_projects_proofreader_user_id_users",
            "projects",
            "users",
            ["proofreader_user_id"],
            ["id"],
            ondelete="SET NULL",
        )
    if _table_exists("projects") and not _foreign_key_exists("projects", "fk_projects_archived_by_users"):
        op.create_foreign_key(
            "fk_projects_archived_by_users",
            "projects",
            "users",
            ["archived_by"],
            ["id"],
            ondelete="SET NULL",
        )
    if _table_exists("projects") and not _foreign_key_exists("projects", "fk_projects_status_changed_by_users"):
        op.create_foreign_key(
            "fk_projects_status_changed_by_users",
            "projects",
            "users",
            ["status_changed_by"],
            ["id"],
            ondelete="SET NULL",
        )

    if _table_exists("projects") and not _index_exists("projects", "ix_projects_source_project_id"):
        op.create_index("ix_projects_source_project_id", "projects", ["source_project_id"], unique=False)
    if _table_exists("projects") and not _index_exists("projects", "ix_projects_executor_user_id"):
        op.create_index("ix_projects_executor_user_id", "projects", ["executor_user_id"], unique=False)
    if _table_exists("projects") and not _index_exists("projects", "ix_projects_proofreader_user_id"):
        op.create_index("ix_projects_proofreader_user_id", "projects", ["proofreader_user_id"], unique=False)
    if _table_exists("projects") and not _index_exists("projects", "ix_projects_archived_at"):
        op.create_index("ix_projects_archived_at", "projects", ["archived_at"], unique=False)
    if _table_exists("projects") and not _index_exists("projects", "ix_projects_archived_by"):
        op.create_index("ix_projects_archived_by", "projects", ["archived_by"], unique=False)
    if _table_exists("projects") and not _index_exists("projects", "ix_projects_status_changed_at"):
        op.create_index("ix_projects_status_changed_at", "projects", ["status_changed_at"], unique=False)
    if _table_exists("projects") and not _index_exists("projects", "ix_projects_status_changed_by"):
        op.create_index("ix_projects_status_changed_by", "projects", ["status_changed_by"], unique=False)

    if _table_exists("projects"):
        op.execute(
            """
            UPDATE projects
            SET status_changed_at = COALESCE(status_changed_at, created_at)
            """
        )
        op.execute(
            """
            UPDATE projects
            SET status_changed_by = COALESCE(status_changed_by, author_user_id)
            """
        )
        op.execute(
            """
            UPDATE projects
            SET archived_at = COALESCE(archived_at, created_at)
            WHERE status = 'archived' AND archived_at IS NULL
            """
        )

    if not _table_exists("project_events"):
        op.create_table(
            "project_events",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "project_id",
                sa.Integer(),
                sa.ForeignKey("projects.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("event_type", sa.String(length=64), nullable=False),
            sa.Column("old_value", sa.Text(), nullable=True),
            sa.Column("new_value", sa.Text(), nullable=True),
            sa.Column(
                "actor_user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column("meta_json", sa.Text(), nullable=True),
        )

    if _table_exists("project_events") and not _index_exists("project_events", "ix_project_events_project_id"):
        op.create_index("ix_project_events_project_id", "project_events", ["project_id"], unique=False)
    if _table_exists("project_events") and not _index_exists("project_events", "ix_project_events_event_type"):
        op.create_index("ix_project_events_event_type", "project_events", ["event_type"], unique=False)
    if _table_exists("project_events") and not _index_exists("project_events", "ix_project_events_actor_user_id"):
        op.create_index("ix_project_events_actor_user_id", "project_events", ["actor_user_id"], unique=False)
    if _table_exists("project_events") and not _index_exists("project_events", "ix_project_events_created_at"):
        op.create_index("ix_project_events_created_at", "project_events", ["created_at"], unique=False)


def downgrade() -> None:
    if _index_exists("project_events", "ix_project_events_created_at"):
        op.drop_index("ix_project_events_created_at", table_name="project_events")
    if _index_exists("project_events", "ix_project_events_actor_user_id"):
        op.drop_index("ix_project_events_actor_user_id", table_name="project_events")
    if _index_exists("project_events", "ix_project_events_event_type"):
        op.drop_index("ix_project_events_event_type", table_name="project_events")
    if _index_exists("project_events", "ix_project_events_project_id"):
        op.drop_index("ix_project_events_project_id", table_name="project_events")
    if _table_exists("project_events"):
        op.drop_table("project_events")

    if _index_exists("projects", "ix_projects_status_changed_by"):
        op.drop_index("ix_projects_status_changed_by", table_name="projects")
    if _index_exists("projects", "ix_projects_status_changed_at"):
        op.drop_index("ix_projects_status_changed_at", table_name="projects")
    if _index_exists("projects", "ix_projects_archived_by"):
        op.drop_index("ix_projects_archived_by", table_name="projects")
    if _index_exists("projects", "ix_projects_archived_at"):
        op.drop_index("ix_projects_archived_at", table_name="projects")
    if _index_exists("projects", "ix_projects_proofreader_user_id"):
        op.drop_index("ix_projects_proofreader_user_id", table_name="projects")
    if _index_exists("projects", "ix_projects_executor_user_id"):
        op.drop_index("ix_projects_executor_user_id", table_name="projects")
    if _index_exists("projects", "ix_projects_source_project_id"):
        op.drop_index("ix_projects_source_project_id", table_name="projects")

    if _foreign_key_exists("projects", "fk_projects_status_changed_by_users"):
        op.drop_constraint("fk_projects_status_changed_by_users", "projects", type_="foreignkey")
    if _foreign_key_exists("projects", "fk_projects_archived_by_users"):
        op.drop_constraint("fk_projects_archived_by_users", "projects", type_="foreignkey")
    if _foreign_key_exists("projects", "fk_projects_proofreader_user_id_users"):
        op.drop_constraint("fk_projects_proofreader_user_id_users", "projects", type_="foreignkey")
    if _foreign_key_exists("projects", "fk_projects_executor_user_id_users"):
        op.drop_constraint("fk_projects_executor_user_id_users", "projects", type_="foreignkey")
    if _foreign_key_exists("projects", "fk_projects_source_project_id_projects"):
        op.drop_constraint("fk_projects_source_project_id_projects", "projects", type_="foreignkey")

    if _column_exists("projects", "status_changed_by"):
        op.drop_column("projects", "status_changed_by")
    if _column_exists("projects", "status_changed_at"):
        op.drop_column("projects", "status_changed_at")
    if _column_exists("projects", "archived_by"):
        op.drop_column("projects", "archived_by")
    if _column_exists("projects", "archived_at"):
        op.drop_column("projects", "archived_at")
    if _column_exists("projects", "proofreader_user_id"):
        op.drop_column("projects", "proofreader_user_id")
    if _column_exists("projects", "executor_user_id"):
        op.drop_column("projects", "executor_user_id")
    if _column_exists("projects", "source_project_id"):
        op.drop_column("projects", "source_project_id")
