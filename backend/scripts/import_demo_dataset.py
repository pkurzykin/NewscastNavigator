from __future__ import annotations

import argparse
from datetime import datetime
import json
from pathlib import Path
import sys

from sqlalchemy import func, select
from sqlalchemy.orm import Session


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.db.models import (
    ExternalApprovalCycle,
    Rubric,
    Scenario,
    ScenarioRevision,
    ScenarioRevisionRow,
    ScenarioRow,
    Story,
    StoryEvent,
    StoryProductionState,
    StoryWorkflowState,
    User,
)
from app.db.session import SessionLocal
from app.services.demo_dataset_validation import validate_demo_dataset
from app.services.runtime_setup import initialize_runtime
from app.services.user_admin import set_user_functions


def _timestamp(value: str) -> datetime:
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    return datetime.fromisoformat(normalized)


def _row_values(row: dict[str, object], *, order_index: int) -> dict[str, object]:
    return {
        "segment_uid": row["segment_uid"],
        "order_index": order_index,
        "block_type": row["block_type"],
        "text": row["text"],
        "speaker_text": row["speaker_text"],
        "file_name": row["file_name"],
        "tc_in": row["tc_in"],
        "tc_out": row["tc_out"],
        "additional_comment": row["additional_comment"],
        "structured_data": row["structured_data"],
        "formatting": row["formatting"],
        "rich_text": row["rich_text"],
    }


def import_demo_dataset(db: Session, payload: object) -> dict[str, int]:
    errors = validate_demo_dataset(payload)
    if errors:
        raise ValueError("Invalid demo dataset: " + "; ".join(errors))
    assert isinstance(payload, dict)
    if int(db.scalar(select(func.count()).select_from(Story)) or 0) != 0:
        raise ValueError("Demo dataset import requires an empty story database")

    try:
        users_by_key: dict[str, User] = {}
        for record in payload["users"]:
            assert isinstance(record, dict)
            username = f"demo-{record['key']}"
            if db.scalar(select(User).where(User.username == username)) is not None:
                raise ValueError(f"Demo user already exists: {username}")
            user = User(
                username=username,
                display_name=str(record["display_name"]),
                position=str(record["position"]),
                password_hash="disabled-sanitized-demo-account",
                is_active=False,
                must_change_password=True,
            )
            set_user_functions(user, tuple(record["functions"]))
            db.add(user)
            users_by_key[str(record["key"])] = user
        db.flush()

        rubrics_by_name = {
            rubric.name: rubric
            for rubric in db.execute(select(Rubric)).scalars().all()
        }
        for name in payload["rubrics"]:
            rubric_name = str(name)
            if rubric_name not in rubrics_by_name:
                rubric = Rubric(name=rubric_name, is_active=True)
                db.add(rubric)
                rubrics_by_name[rubric_name] = rubric
        db.flush()

        scenario_row_count = 0
        for record in payload["stories"]:
            assert isinstance(record, dict)
            actor = users_by_key[str(record["author_key"])]
            rubric = rubrics_by_name[str(record["rubric"])]
            aired_at = _timestamp(str(record["aired_at"]))
            archived_at = _timestamp(str(record["archived_at"]))
            story = Story(
                title=str(record["title"]).strip(),
                rubric_id=rubric.id,
                author_user_id=actor.id,
                priority=str(record["priority"]),
                created_at=aired_at,
                updated_at=archived_at,
                aired_at=aired_at,
                aired_by_user_id=actor.id,
                archived_at=archived_at,
                archived_by_user_id=actor.id,
            )
            db.add(story)
            db.flush()
            scenario = Scenario(
                story_id=story.id,
                revision_no=1,
                updated_at=archived_at,
            )
            db.add(scenario)
            db.flush()
            revision = ScenarioRevision(
                scenario_id=scenario.id,
                revision_no=1,
                client_save_id=f"demo-import-{record['external_id']}",
                created_by_user_id=actor.id,
                created_at=aired_at,
            )
            db.add(revision)
            db.flush()
            for order_index, row in enumerate(record["scenario_rows"]):
                assert isinstance(row, dict)
                values = _row_values(row, order_index=order_index)
                db.add(ScenarioRow(scenario_id=scenario.id, **values))
                db.add(ScenarioRevisionRow(revision_id=revision.id, **values))
                scenario_row_count += 1
            db.add_all(
                [
                    StoryWorkflowState(
                        story_id=story.id,
                        review_requested_revision=1,
                        review_requested_by_user_id=actor.id,
                        review_requested_at=aired_at,
                        editorial_revision=1,
                        editorial_by_user_id=actor.id,
                        editorial_at=aired_at,
                        proofread_revision=1,
                        proofread_by_user_id=actor.id,
                        proofread_at=aired_at,
                    ),
                    StoryProductionState(
                        story_id=story.id,
                        voiceover_ready=True,
                        voiceover_ready_by_user_id=actor.id,
                        voiceover_ready_at=aired_at,
                        video_started_revision=1,
                        video_started_by_user_id=actor.id,
                        video_started_at=aired_at,
                        video_ready_by_user_id=actor.id,
                        video_ready_at=aired_at,
                        video_approved_for_titles_by_user_id=actor.id,
                        video_approved_for_titles_at=aired_at,
                        titles_started_revision=1,
                        titles_started_by_user_id=actor.id,
                        titles_started_at=aired_at,
                        titles_ready_by_user_id=actor.id,
                        titles_ready_at=aired_at,
                        titles_accepted_by_user_id=actor.id,
                        titles_accepted_at=aired_at,
                    ),
                    ExternalApprovalCycle(
                        story_id=story.id,
                        cycle_no=1,
                        sent_by_user_id=actor.id,
                        sent_at=aired_at,
                        result="approved",
                        decided_by_user_id=actor.id,
                        decided_at=aired_at,
                    ),
                    StoryEvent(
                        story_id=story.id,
                        event_code="demo_story_imported",
                        actor_user_id=actor.id,
                        revision_no=1,
                        payload={"external_id": record["external_id"]},
                        created_at=archived_at,
                    ),
                ]
            )
        db.commit()
        return {
            "users": len(payload["users"]),
            "rubrics": len(payload["rubrics"]),
            "stories": len(payload["stories"]),
            "scenario_rows": scenario_row_count,
        }
    except Exception:
        db.rollback()
        raise


def _read_json(input_path: str) -> object:
    if input_path == "-":
        return json.load(sys.stdin)
    with Path(input_path).open(encoding="utf-8") as source:
        return json.load(source)


def main() -> int:
    parser = argparse.ArgumentParser(description="Import a validated sanitized demo dataset")
    parser.add_argument("--input", required=True)
    args = parser.parse_args()

    payload = _read_json(args.input)
    initialize_runtime(seed_demo_records=False)
    with SessionLocal() as db:
        result = import_demo_dataset(db, payload)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
