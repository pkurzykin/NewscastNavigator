from __future__ import annotations

import argparse
from collections.abc import Mapping
import os
from pathlib import Path
import sys
import tempfile
from types import MappingProxyType
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.scenario_docx_renderer import render_scenario_docx
from app.services.scenario_docx_snapshot import (
    DocxFileBundle,
    ScenarioDocxRow,
    ScenarioDocxSnapshot,
)


REPO_ROOT = Path(__file__).resolve().parents[2]
ARTIFACT_ROOT = REPO_ROOT / "artifacts/product-reset/V1_1_0/docx-export"


def _freeze(value: Any) -> Any:
    if isinstance(value, dict):
        return MappingProxyType({key: _freeze(item) for key, item in value.items()})
    if isinstance(value, list):
        return tuple(_freeze(item) for item in value)
    return value


def _formatting(
    *,
    font_family: str,
    fill_color: str,
    bold: bool = False,
    italic: bool = False,
    strikethrough: bool = False,
) -> Mapping[str, Any]:
    return _freeze(
        {
            "targets": {
                "text": {
                    "font_family": font_family,
                    "fill_color": fill_color,
                    "bold": bold,
                    "italic": italic,
                    "strikethrough": strikethrough,
                }
            }
        }
    )


def _row(
    block_type: str,
    text: str,
    *,
    speaker_text: str = "",
    additional_comment: str = "",
    structured_data: Mapping[str, Any] | None = None,
    formatting: Mapping[str, Any] | None = None,
    rich_text: Mapping[str, Any] | None = None,
    file_bundles: tuple[DocxFileBundle, ...] = (),
) -> ScenarioDocxRow:
    return ScenarioDocxRow(
        block_type=block_type,
        text=text,
        speaker_text=speaker_text,
        additional_comment=additional_comment,
        structured_data=structured_data or MappingProxyType({}),
        formatting=formatting or MappingProxyType({}),
        rich_text=rich_text or MappingProxyType({}),
        file_bundles=file_bundles,
    )


def build_synthetic_snapshot(
    *,
    duration_text: str | None = "до 02:15",
) -> ScenarioDocxSnapshot:
    natural_wrap_text = (
        "ЕСТЕСТВЕННЫЙ СИНТЕТИЧЕСКИЙ ПЕРЕНОС проверяет заметное выравнивание "
        "по ширине: этот длинный абзац содержит только вымышленные слова и "
        "обычные пробелы, поэтому редактор документа сам распределяет текст "
        "по нескольким строкам внутри первой рабочей колонки без ручных "
        "переводов строки, скрытых разрывов или реальных материалов выпуска; "
        "каждая строка остаётся читаемой, а правая граница абзаца визуально "
        "показывает действие утверждённого форматирования."
    )
    long_text = "\n".join(
        [
            natural_wrap_text,
            "БЛОК-ПОДВОДКА",
            *(f"СИНТЕТИЧЕСКАЯ СТРОКА {index:03d}" for index in range(1, 241)),
        ]
    )
    zk_text = "БЛОК-ЗК жирный курсив\nручной перенос"
    zk_rich_text = _freeze(
        {
            "targets": {
                "text": {
                    "doc": {
                        "type": "doc",
                        "content": [
                            {
                                "type": "paragraph",
                                "content": [
                                    {
                                        "type": "text",
                                        "text": "БЛОК-ЗК ",
                                        "marks": [{"type": "bold"}],
                                    },
                                    {
                                        "type": "text",
                                        "text": "жирный",
                                        "marks": [
                                            {"type": "italic"},
                                            {"type": "strike"},
                                            {
                                                "type": "textStyle",
                                                "attrs": {"fontFamily": "Arial"},
                                            },
                                            {
                                                "type": "highlight",
                                                "attrs": {"color": "#ff0000"},
                                            },
                                        ],
                                    },
                                    {"type": "text", "text": " курсив"},
                                    {"type": "hardBreak"},
                                    {"type": "text", "text": "ручной перенос"},
                                ],
                            }
                        ],
                    }
                }
            }
        }
    )
    geo_formatting = _freeze(
        {
            "targets": {
                "geo": {
                    "font_family": "Times New Roman",
                    "fill_color": "#0000ff",
                    "bold": False,
                    "italic": True,
                    "strikethrough": False,
                },
                "text": {
                    "font_family": "Georgia",
                    "fill_color": "#00ff00",
                    "bold": True,
                    "italic": False,
                    "strikethrough": True,
                },
            }
        }
    )
    snh_formatting = _freeze(
        {
            "targets": {
                "speaker_fio": {
                    "font_family": "PT Sans",
                    "fill_color": "#ffffff",
                    "bold": True,
                    "italic": True,
                    "strikethrough": False,
                },
                "speaker_position": {
                    "font_family": "PT Sans",
                    "fill_color": "#ffff00",
                    "bold": True,
                    "italic": True,
                    "strikethrough": False,
                },
                "text": {
                    "font_family": "Roboto Slab",
                    "fill_color": "#ffa500",
                    "bold": False,
                    "italic": True,
                    "strikethrough": False,
                },
            }
        }
    )
    return ScenarioDocxSnapshot(
        story_id=1100,
        title=(
            "СИНТЕТИЧЕСКИЙ МАКЕТ 1.1.0 — ДЛИННОЕ НАЗВАНИЕ ДЛЯ ПРОВЕРКИ "
            "ПОЛНОГО ПЕРЕНОСА БЕЗ СОКРАЩЕНИЯ И БЕЗ РЕАЛЬНЫХ ДАННЫХ"
        ),
        rubric_id=110,
        rubric_name="СИНТЕТИЧЕСКАЯ РУБРИКА",
        duration_text=duration_text,
        revision=11,
        rows=(
            _row(
                "podvodka",
                long_text,
                formatting=_formatting(
                    font_family="PT Sans",
                    fill_color="#ffff00",
                    bold=True,
                ),
            ),
            _row(
                "zk",
                zk_text,
                additional_comment="СИНТЕТИЧЕСКИЙ КОММЕНТАРИЙ ДЛЯ ВИДЕО",
                formatting=_formatting(
                    font_family="Arial",
                    fill_color="#ff0000",
                    italic=True,
                    strikethrough=True,
                ),
                rich_text=zk_rich_text,
                file_bundles=(
                    DocxFileBundle(
                        file_name="synthetic-bundle-a.mov",
                        tc_in="00:00:01:00",
                        tc_out="00:00:05:00",
                    ),
                    DocxFileBundle(
                        file_name="synthetic-bundle-b.mov",
                        tc_in="00:00:06:00",
                        tc_out="00:00:09:00",
                    ),
                ),
            ),
            _row(
                "zk_geo",
                "БЛОК-ЗК-ГЕО",
                structured_data=_freeze({"geo": "СИНТЕТИЧЕСКАЯ ГЕОПРИВЯЗКА"}),
                formatting=geo_formatting,
            ),
            _row(
                "snh",
                "БЛОК-СНХ",
                speaker_text=(
                    "СИНТЕТИЧЕСКИЙ СПИКЕР\nСИНТЕТИЧЕСКАЯ ДОЛЖНОСТЬ"
                ),
                formatting=snh_formatting,
            ),
            _row(
                "life",
                "БЛОК-ЛАЙФ",
                formatting=_formatting(
                    font_family="PT Sans",
                    fill_color="#ffffff",
                    italic=True,
                ),
            ),
        ),
    )


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True


def _validated_output(parser: argparse.ArgumentParser, raw_output: Path) -> Path:
    if raw_output.suffix.casefold() != ".docx":
        parser.error("Параметр --output должен указывать файл с расширением .docx")
    absolute = raw_output.expanduser().absolute()
    if absolute.is_symlink():
        parser.error("Параметр --output не должен указывать на символическую ссылку")
    output = absolute.parent.resolve(strict=False) / absolute.name
    repo_root = REPO_ROOT.resolve()
    artifact_root = ARTIFACT_ROOT.resolve()
    if _is_within(output, repo_root):
        if not _is_within(output, artifact_root):
            parser.error(
                "В репозитории файл --output должен находиться в "
                "artifacts/product-reset/V1_1_0/docx-export"
            )
    else:
        temp_roots = {
            Path("/tmp").resolve(),
            Path(tempfile.gettempdir()).resolve(),
        }
        if not any(_is_within(output, root) for root in temp_roots):
            parser.error(
                "Файл --output должен находиться в "
                "artifacts/product-reset/V1_1_0/docx-export или /tmp"
            )
    if output.exists() and not output.is_file():
        parser.error("Параметр --output должен указывать на обычный DOCX-файл")
    return output


def _write_output_atomically(output: Path, payload: bytes) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=output.parent,
            prefix=f".{output.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
            temporary.write(payload)
            temporary.flush()
            os.fsync(temporary.fileno())
        os.replace(temporary_path, output)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Создать синтетический DOCX-макет NewscastNavigator для проверки."
    )
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    output = _validated_output(parser, args.output)
    payload = render_scenario_docx(build_synthetic_snapshot()).getvalue()
    _write_output_atomically(output, payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
