from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import ActionRef
from app.schemas.corrections import CorrectionPartCreateRequest
from app.schemas.stories import UserRef


ExternalApprovalResult = Literal["pending", "approved", "changes_requested"]


class EmptyExternalApprovalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ExternalApprovalResultRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    result: Literal["approved", "changes_requested"]
    parts: list[CorrectionPartCreateRequest] = Field(default_factory=list)


class ExternalApprovalCycleRef(BaseModel):
    id: int
    cycle_no: int
    sent_by: UserRef
    sent_at: datetime
    result: ExternalApprovalResult
    decided_by: UserRef | None
    decided_at: datetime | None
    correction_package_id: int | None
    primary_action: ActionRef | None
    additional_actions: list[ActionRef]


class ExternalApprovalCyclesResponse(BaseModel):
    story_id: int
    items: list[ExternalApprovalCycleRef]
    assignee_options: list[UserRef]
    send_action: ActionRef | None


class ExternalApprovalSummaryRef(BaseModel):
    href: str
    total_count: int
    pending_cycle_no: int | None
    last_result: ExternalApprovalResult | None
