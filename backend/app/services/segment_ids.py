from __future__ import annotations

from uuid import uuid4


def generate_segment_uid() -> str:
    return f"seg_{uuid4().hex}"
