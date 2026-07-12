from __future__ import annotations


FUNCTION_CODES = frozenset(
    {
        "chief",
        "chief_editor",
        "author",
        "proofreader",
        "video_editor",
        "designer",
        "operator",
    }
)
LEADERSHIP_FUNCTION_CODES = frozenset({"chief", "chief_editor"})
ASSIGNMENT_KINDS = frozenset({"proofreader", "video_editor", "designer"})
STORY_PRIORITIES = frozenset({"standard", "high"})
SCENARIO_BLOCK_TYPES = frozenset({"podvodka", "zk", "snh", "standup", "geo"})
CORRECTION_SCOPES = frozenset({"text", "video", "titles", "voiceover"})
