from __future__ import annotations

import re


_TITLE_LINE_BOUNDARIES = re.compile(
    r"[^\S\r\n]*(?:(?:\r\n)|\r|\n)+[^\S\r\n]*"
)


def normalize_story_title(value: str) -> str:
    """Return the canonical single-logical-line story title."""

    return _TITLE_LINE_BOUNDARIES.sub(" ", value).strip()
