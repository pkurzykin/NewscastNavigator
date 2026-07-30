from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column, validates

from app.db.base import Base


def rubric_name_key(name: str) -> str:
    return " ".join(name.split()).casefold()


class Rubric(Base):
    __tablename__ = "rubrics"
    __table_args__ = (
        Index("uq_rubrics_name_key", "name_key", unique=True),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    name_key: Mapped[str] = mapped_column(String(360))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1", index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    @validates("name")
    def _set_name_key(self, _key: str, value: str) -> str:
        self.name_key = rubric_name_key(value)
        return value
