from __future__ import annotations

import io
import textwrap
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, aliased

from app.core.config import get_settings
from app.db.models import Project, ScriptElement, User

try:
    from docx import Document
except Exception:
    Document = None

try:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfgen import canvas as pdf_canvas
except Exception:
    A4 = None
    TTFont = None
    pdf_canvas = None
    pdfmetrics = None


DOCX_EXPORT_AVAILABLE = Document is not None
PDF_EXPORT_AVAILABLE = A4 is not None and TTFont is not None and pdf_canvas is not None and pdfmetrics is not None

_PDF_FONT_REGISTERED = False
_PDF_FONT_NAME = "Helvetica"

_BLOCK_LABELS = {
    "podvodka": "Подводка",
    "zk": "ЗК",
    "life": "Лайф",
    "snh": "СНХ",
}


class ExportInputNotFoundError(Exception):
    pass


def _format_datetime(value: datetime | None) -> str:
    if value is None:
        return "-"
    return value.strftime("%d.%m.%Y %H:%M")


def _normalize_value(value: str | None) -> str:
    return (value or "").strip()


def _block_label(value: str | None) -> str:
    key = (value or "").strip().lower()
    return _BLOCK_LABELS.get(key, key or "-")


def _resolve_export_root() -> Path:
    root = Path(get_settings().export_root).expanduser()
    if not root.is_absolute():
        root = (Path.cwd() / root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def persist_export_bytes(
    *,
    project_id: int,
    file_name: str,
    content: bytes,
) -> Path:
    timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    export_root = _resolve_export_root()
    project_dir = export_root / "projects" / str(project_id)
    project_dir.mkdir(parents=True, exist_ok=True)

    source_path = Path(file_name)
    target_path = project_dir / f"{source_path.stem}-{timestamp}{source_path.suffix}"
    target_path.write_bytes(content)
    return target_path


def fetch_export_payload(db: Session, project_id: int) -> dict[str, Any]:
    author_user = aliased(User)
    executor_user = aliased(User)
    proofreader_user = aliased(User)
    row = db.execute(
        select(Project, author_user.username, executor_user.username, proofreader_user.username)
        .outerjoin(author_user, author_user.id == Project.author_user_id)
        .outerjoin(executor_user, executor_user.id == Project.executor_user_id)
        .outerjoin(proofreader_user, proofreader_user.id == Project.proofreader_user_id)
        .where(Project.id == project_id)
    ).first()
    if row is None:
        raise ExportInputNotFoundError("Проект не найден")

    project: Project = row[0]
    author_username: str | None = row[1]
    executor_username: str | None = row[2]
    proofreader_username: str | None = row[3]
    elements = db.execute(
        select(ScriptElement)
        .where(ScriptElement.project_id == project_id)
        .order_by(ScriptElement.order_index.asc(), ScriptElement.id.asc())
    ).scalars().all()

    payload_rows = []
    for index, item in enumerate(elements, start=1):
        payload_rows.append(
            {
                "index": index,
                "block": _block_label(item.block_type),
                "text": _normalize_value(item.text),
                "speaker_text": _normalize_value(item.speaker_text),
                "file_name": _normalize_value(item.file_name),
                "tc_in": _normalize_value(item.tc_in),
                "tc_out": _normalize_value(item.tc_out),
                "additional_comment": _normalize_value(item.additional_comment),
            }
        )

    return {
        "project_id": project.id,
        "title": project.title,
        "status": project.status,
        "rubric": _normalize_value(project.rubric),
        "planned_duration": _normalize_value(project.planned_duration),
        "project_note": _normalize_value(project.project_note),
        "author_username": author_username or "-",
        "executor_username": executor_username or "-",
        "proofreader_username": proofreader_username or "-",
        "created_at": _format_datetime(project.created_at),
        "rows": payload_rows,
    }


def generate_docx_bytes(payload: dict[str, Any]) -> bytes:
    if not DOCX_EXPORT_AVAILABLE:
        raise RuntimeError("Для DOCX установите пакет python-docx")

    document = Document()
    document.add_heading("Newscast Navigator", level=1)
    document.add_paragraph(f"Проект: {payload['title']}")
    document.add_paragraph(
        f"Рубрика: {payload['rubric'] or '-'} | Хронометраж: {payload['planned_duration'] or '-'}"
    )
    document.add_paragraph(
        f"Автор: {payload['author_username']} | Создан: {payload['created_at']}"
    )
    document.add_paragraph(
        f"Исполнитель: {payload['executor_username']} | Корректор: {payload['proofreader_username']}"
    )
    if payload["project_note"]:
        document.add_paragraph(f"Комментарий проекта: {payload['project_note']}")

    headers = ["№", "Блок", "Текст", "Титр", "Имя файла", "TC IN", "TC OUT", "Комментарий"]
    table = document.add_table(rows=1, cols=len(headers))
    table.style = "Table Grid"
    for col, header in enumerate(headers):
        table.rows[0].cells[col].text = header

    for row in payload["rows"]:
        cells = table.add_row().cells
        cells[0].text = str(row["index"])
        cells[1].text = row["block"]
        cells[2].text = row["text"]
        cells[3].text = row["speaker_text"]
        cells[4].text = row["file_name"]
        cells[5].text = row["tc_in"]
        cells[6].text = row["tc_out"]
        cells[7].text = row["additional_comment"]

    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def _ensure_pdf_font() -> str:
    global _PDF_FONT_REGISTERED, _PDF_FONT_NAME

    if not PDF_EXPORT_AVAILABLE:
        return "Helvetica"
    if _PDF_FONT_REGISTERED:
        return _PDF_FONT_NAME

    candidates = [
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/usr/share/fonts/dejavu/DejaVuSans.ttf"),
        Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
        Path("/Library/Fonts/Arial Unicode.ttf"),
    ]
    for candidate in candidates:
        if not candidate.exists():
            continue
        try:
            pdfmetrics.registerFont(TTFont("NewscastUnicode", str(candidate)))
            _PDF_FONT_NAME = "NewscastUnicode"
            _PDF_FONT_REGISTERED = True
            return _PDF_FONT_NAME
        except Exception:
            continue

    _PDF_FONT_REGISTERED = True
    _PDF_FONT_NAME = "Helvetica"
    return _PDF_FONT_NAME


def generate_pdf_bytes(payload: dict[str, Any]) -> bytes:
    if not PDF_EXPORT_AVAILABLE:
        raise RuntimeError("Для PDF установите пакет reportlab")

    buffer = io.BytesIO()
    pdf = pdf_canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    margin_x = 40
    margin_top = 40
    y = height - margin_top
    line_height = 14
    font_name = _ensure_pdf_font()
    pdf.setFont(font_name, 10)

    lines = [
        "Newscast Navigator",
        f"Проект: {payload['title']}",
        f"Рубрика: {payload['rubric'] or '-'} | Хронометраж: {payload['planned_duration'] or '-'}",
        f"Автор: {payload['author_username']} | Создан: {payload['created_at']}",
        f"Исполнитель: {payload['executor_username']} | Корректор: {payload['proofreader_username']}",
        f"Комментарий проекта: {payload['project_note'] or '-'}",
        "",
    ]
    for row in payload["rows"]:
        lines.extend(
            [
                f"#{row['index']} | {row['block']}",
                f"Текст: {row['text'] or '-'}",
                f"Титр: {row['speaker_text'] or '-'}",
                f"Файл: {row['file_name'] or '-'} | TC: {row['tc_in'] or '-'} - {row['tc_out'] or '-'}",
                f"Комментарий: {row['additional_comment'] or '-'}",
                "",
            ]
        )

    max_width_chars = 110
    for line in lines:
        wrapped_lines = textwrap.wrap(line, width=max_width_chars) if line else [""]
        for wrapped in wrapped_lines:
            if y <= 35:
                pdf.showPage()
                pdf.setFont(font_name, 10)
                y = height - margin_top
            pdf.drawString(margin_x, y, wrapped)
            y -= line_height

    pdf.save()
    return buffer.getvalue()
