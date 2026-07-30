from __future__ import annotations


FUNCTION_CODE_ORDER = (
    "chief",
    "chief_editor",
    "author",
    "proofreader",
    "video_editor",
    "designer",
    "operator",
)
FUNCTION_CODES = frozenset(FUNCTION_CODE_ORDER)
FUNCTION_LABELS: dict[str, str] = {
    "chief": "Начальник",
    "chief_editor": "Шеф-редактор",
    "author": "Автор",
    "proofreader": "Корректор",
    "video_editor": "Монтажёр",
    "designer": "Дизайнер",
    "operator": "Оператор",
}
LEADERSHIP_FUNCTION_CODES = frozenset({"chief", "chief_editor"})
ASSIGNMENT_KINDS = frozenset({"proofreader", "video_editor", "designer"})
STORY_PRIORITIES = frozenset({"standard", "high"})
SCENARIO_BLOCK_TYPES = frozenset({"podvodka", "zk", "zk_geo", "life", "snh"})
CORRECTION_SCOPES = frozenset({"text", "video", "titles", "voiceover"})
DEFAULT_RUBRIC_NAMES = (
    "Новости",
    "Специальный репортаж",
    "Транснефть помогает",
    "Волонтеры Транснефти",
    "Люди компании",
    "Новость дня",
    "Оптимум",
    "Спорт",
)
