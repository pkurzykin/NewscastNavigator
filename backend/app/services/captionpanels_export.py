from __future__ import annotations

import re
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any
from uuid import NAMESPACE_URL, uuid5

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Rubric, Scenario, ScenarioRow, Story
from app.schemas.captionpanels_import import (
    CaptionPanelsImportDocument,
    CaptionPanelsImportMeta,
    CaptionPanelsImportSegment,
    CaptionPanelsImportSpeaker,
)
from app.services.story_service import lock_story_aggregate


class CaptionPanelsStoryNotFoundError(Exception):
    pass


@dataclass(frozen=True)
class CaptionPanelsCurrentExport:
    payload: dict[str, Any]
    revision: int
    story: Story
    scenario: Scenario


class _VisibleRichTextHtmlParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.strike_depth = 0

    def handle_starttag(self, tag: str, _attrs: list[tuple[str, str | None]]) -> None:
        normalized_tag = tag.lower()
        if normalized_tag in {"s", "strike", "del"}:
            self.strike_depth += 1
        elif normalized_tag == "br" and self.strike_depth == 0:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        normalized_tag = tag.lower()
        if normalized_tag in {"s", "strike", "del"}:
            self.strike_depth = max(0, self.strike_depth - 1)
        elif normalized_tag in {"p", "div", "li"} and self.strike_depth == 0 and self.parts and self.parts[-1] != "\n":
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self.strike_depth == 0:
            self.parts.append(data)

    def text(self) -> str:
        return "".join(self.parts)


def build_story_uid(story_id: int) -> str:
    return f"story_{story_id}"


def _normalize_captionpanels_text(value: str) -> str:
    text = str(value or "").replace("\r", "")
    return "\n".join(
        line for line in (re.sub(r"[ \t]{2,}", " ", item).strip() for item in text.split("\n")) if line
    )


def _normalize_text_lines(value: str) -> list[str]:
    return [line.strip() for line in str(value or "").replace("\r", "").split("\n") if line.strip()]


def _visible_doc_text(node: Any, strike_active: bool = False) -> str:
    if not isinstance(node, dict):
        return ""
    marks = node.get("marks") if isinstance(node.get("marks"), list) else []
    struck = strike_active or any(
        isinstance(mark, dict) and str(mark.get("type") or "") == "strike" for mark in marks
    )
    node_type = str(node.get("type") or "")
    if node_type == "text":
        return "" if struck else str(node.get("text") or "")
    if node_type == "hardBreak":
        return "\n"
    content = node.get("content") if isinstance(node.get("content"), list) else []
    text = "".join(_visible_doc_text(item, struck) for item in content)
    if node_type in {"paragraph", "heading", "listItem"} and text and not text.endswith("\n"):
        return f"{text}\n"
    return text


def _visible_row_text(row: ScenarioRow, *, target: str, fallback: str) -> str:
    rich_text = row.rich_text if isinstance(row.rich_text, dict) else {}
    targets = rich_text.get("targets") if isinstance(rich_text.get("targets"), dict) else {}
    target_value = targets.get(target) if isinstance(targets, dict) else {}
    if not isinstance(target_value, dict):
        return _normalize_captionpanels_text(fallback)
    visible_text = _visible_doc_text(target_value.get("doc"))
    if not visible_text:
        html = str(target_value.get("html") or "")
        if html:
            parser = _VisibleRichTextHtmlParser()
            parser.feed(html)
            parser.close()
            visible_text = parser.text()
    return _normalize_captionpanels_text(visible_text or str(target_value.get("text") or fallback))


def _speaker_id(story_uid: str, *, name: str, job: str) -> str:
    key = f"{story_uid}:{name.strip().lower()}:{job.strip().lower()}"
    return f"speaker_{uuid5(NAMESPACE_URL, key).hex[:16]}"


def _speaker_parts(value: str) -> tuple[str, str]:
    lines = _normalize_text_lines(value)
    return (lines[0] if lines else "", lines[1] if len(lines) > 1 else "")


def _build_captionpanels_import_payload(
    db: Session,
    *,
    story: Story,
    scenario: Scenario,
) -> dict[str, Any]:
    rubric = db.get(Rubric, story.rubric_id)
    rows = db.execute(
        select(ScenarioRow)
        .where(ScenarioRow.scenario_id == scenario.id)
        .order_by(ScenarioRow.order_index.asc(), ScenarioRow.id.asc())
    ).scalars().all()
    story_uid = build_story_uid(story.id)
    speakers: dict[str, CaptionPanelsImportSpeaker] = {}
    segments: list[CaptionPanelsImportSegment] = []
    previous_block_type: str | None = None
    for row in rows:
        block_type = (row.block_type or "zk").strip().lower()
        if block_type == "podvodka":
            previous_block_type = None
            continue
        target_type = "life" if block_type == "life" else "synch" if block_type == "snh" else "voiceover"
        if block_type == "zk_geo":
            geo = _visible_row_text(row, target="geo", fallback=str((row.structured_data or {}).get("geo") or ""))
            if geo:
                segments.append(CaptionPanelsImportSegment(id=f"{row.segment_uid}:geo", type="geotag", text=geo))
        text = _visible_row_text(row, target="text", fallback=row.text)
        if not text:
            previous_block_type = None
            continue
        speaker_id: str | None = None
        if block_type == "snh":
            name, job = _speaker_parts(row.speaker_text)
            if name or job:
                speaker_id = _speaker_id(story_uid, name=name, job=job)
                speakers.setdefault(speaker_id, CaptionPanelsImportSpeaker(id=speaker_id, name=name, job=job))
        if block_type == "zk" and previous_block_type == "zk" and segments and segments[-1].type == "voiceover":
            previous = segments[-1]
            segments[-1] = CaptionPanelsImportSegment(
                id=previous.id,
                type=previous.type,
                text=f"{previous.text}\n{text}" if previous.text else text,
                speaker_id=previous.speaker_id,
            )
        else:
            segments.append(
                CaptionPanelsImportSegment(id=row.segment_uid, type=target_type, text=text, speaker_id=speaker_id)
            )
        previous_block_type = block_type
    return CaptionPanelsImportDocument(
        meta=CaptionPanelsImportMeta(title=story.title, rubric=rubric.name if rubric is not None else ""),
        speakers=list(speakers.values()),
        segments=segments,
    ).model_dump(mode="json", by_alias=True, exclude_none=True)


def build_captionpanels_current_export(db: Session, story_id: int) -> CaptionPanelsCurrentExport:
    try:
        story, scenario, _workflow, _production = lock_story_aggregate(
            db,
            story_id=story_id,
        )
    except HTTPException as exc:
        if exc.status_code == 404:
            raise CaptionPanelsStoryNotFoundError("Сюжет не найден") from exc
        raise
    return CaptionPanelsCurrentExport(
        payload=_build_captionpanels_import_payload(db, story=story, scenario=scenario),
        revision=scenario.revision_no,
        story=story,
        scenario=scenario,
    )
