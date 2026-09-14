from uuid import uuid4

from sqlalchemy.orm import Session

from app.db.models import ScenarioRow


def create_initial_scenario_rows(db: Session, *, scenario_id: int) -> None:
    """Called only inside story creation; reads and later edits never reseed rows."""
    db.add_all(
        ScenarioRow(
            scenario_id=scenario_id,
            segment_uid=f"seg_{uuid4()}",
            order_index=index,
            block_type=block_type,
        )
        for index, block_type in enumerate(("podvodka", "zk", "snh", "zk"), start=1)
    )
