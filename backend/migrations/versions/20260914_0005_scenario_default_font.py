"""Persist the scenario font with each immutable snapshot."""
import hashlib
import json
from alembic import op
import sqlalchemy as sa

revision = "20260914_0005"
down_revision = "20260806_0004"
branch_labels = None
depends_on = None


def upgrade():
    for table in ("scenarios", "scenario_revisions"):
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column("default_font_family", sa.String(64), nullable=False, server_default="PT Sans"))
            batch.create_check_constraint(f"ck_{table}_default_font", "default_font_family IN ('PT Sans','Franklin Gothic Book')")
    sessions = sa.table("scenario_edit_sessions", sa.column("id", sa.Integer), sa.column("diff_payload", sa.JSON))
    connection = op.get_bind()
    for item in connection.execute(sa.select(sessions.c.id, sessions.c.diff_payload)).mappings():
        payload = item["diff_payload"]
        if not payload or not payload.get("save_hashes"):
            continue
        hashes = {key: hashlib.sha256(json.dumps({"rows_hash": value, "default_font_family": "PT Sans"}, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest() for key, value in payload["save_hashes"].items()}
        connection.execute(sessions.update().where(sessions.c.id == item["id"]).values(diff_payload={**payload, "save_hashes": hashes}))


def downgrade():
    # Font-aware hashes cannot be inverted. Drop only retry caches; retained snapshots
    # still support normal row comparisons on the older schema.
    sessions = sa.table("scenario_edit_sessions", sa.column("id", sa.Integer), sa.column("diff_payload", sa.JSON))
    connection = op.get_bind()
    for item in connection.execute(sa.select(sessions.c.id, sessions.c.diff_payload)).mappings():
        payload = item["diff_payload"]
        if payload and payload.get("save_hashes"):
            connection.execute(sessions.update().where(sessions.c.id == item["id"]).values(diff_payload={**payload, "save_hashes": {}}))
    for table in ("scenario_revisions", "scenarios"):
        with op.batch_alter_table(table) as batch:
            batch.drop_constraint(f"ck_{table}_default_font", type_="check")
            batch.drop_column("default_font_family")
