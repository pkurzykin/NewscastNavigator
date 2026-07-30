from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import ActionRef
from app.schemas.stories import UserRef


class WorkflowCommandRequest(BaseModel):
    revision: int = Field(ge=0)


class MarkRef(BaseModel):
    revision: int
    actor: UserRef
    at: datetime


class WorkflowReadResponse(BaseModel):
    story_id: int
    review_request: MarkRef | None
    editorial_check: MarkRef | None
    proofread: MarkRef | None
    changed_after_proofread: bool
    reproofread_request: MarkRef | None
    primary_action: ActionRef | None
    additional_actions: list[ActionRef]
