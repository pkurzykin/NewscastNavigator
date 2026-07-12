from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class ResourceRef(BaseModel):
    type: str
    id: int


class CommandAck(BaseModel):
    ok: bool = True
    event_id: str | None = None
    changed_at: datetime
    resource: ResourceRef | None = None
