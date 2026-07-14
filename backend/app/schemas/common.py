from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class ResourceRef(BaseModel):
    type: str
    id: int


class ActionRef(BaseModel):
    code: str
    label: str
    method: Literal["GET", "POST", "PATCH", "PUT", "DELETE"]
    href: str
    emphasis: Literal["primary", "normal", "danger"] = "normal"
    confirmation: str | None = None
    form: str | None = None


class CommandAck(BaseModel):
    ok: bool = True
    event_id: str | None = None
    changed_at: datetime
    resource: ResourceRef | None = None
