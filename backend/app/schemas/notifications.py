from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.schemas.common import ActionRef
from app.schemas.corrections import CorrectionActionRef
from app.schemas.stories import CodeLabel, UserRef


class NotificationStoryRef(BaseModel):
    id: int
    title: str
    priority: CodeLabel


class NotificationDiffSummary(BaseModel):
    added: int = 0
    removed: int = 0
    changed: int = 0
    moved: int = 0
    total: int = 0


class NotificationDiffRef(BaseModel):
    from_revision: int
    to_revision: int
    summary: NotificationDiffSummary
    changes: list[dict[str, Any]] = Field(default_factory=list)
    href: str | None = None


class NotificationRef(BaseModel):
    id: int
    kind: str
    story: NotificationStoryRef
    actor: UserRef | None
    title: str
    summary: str
    target_href: str
    diff: NotificationDiffRef | None
    created_at: datetime
    updated_at: datetime
    read_at: datetime | None


class NotificationListResponse(BaseModel):
    items: list[NotificationRef]
    total: int
    unread_count: int


class PersonalActionRef(BaseModel):
    id: str
    story: NotificationStoryRef
    summary: str
    target_href: str
    action: CorrectionActionRef | ActionRef


class PersonalActionListResponse(BaseModel):
    items: list[PersonalActionRef]
    total: int


class EmptyNotificationRequest(BaseModel):
    pass
