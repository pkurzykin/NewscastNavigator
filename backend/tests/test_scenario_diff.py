from app.services.scenario_diff import build_scenario_diff


def _row(segment_uid: str, order_index: int) -> dict:
    return {
        "segment_uid": segment_uid,
        "order_index": order_index,
        "block_type": "zk",
        "text": segment_uid,
        "speaker_text": "",
        "file_name": "",
        "tc_in": "",
        "tc_out": "",
        "additional_comment": "",
        "structured_data": {},
        "formatting": {},
        "rich_text": {},
    }


def test_inserting_a_row_does_not_report_unchanged_rows_as_moved() -> None:
    before = [_row("a", 1), _row("b", 2)]
    after = [_row("x", 1), _row("a", 2), _row("b", 3)]

    summary, changes = build_scenario_diff(before, after)

    assert summary == {"added": 1, "removed": 0, "changed": 0, "moved": 0, "total": 1}
    assert [(change["segment_uid"], change["kind"]) for change in changes] == [("x", "added")]


def test_relative_reorder_reports_only_the_minimum_moved_rows() -> None:
    before = [_row("a", 1), _row("b", 2), _row("c", 3)]
    after = [_row("b", 1), _row("a", 2), _row("c", 3)]

    summary, changes = build_scenario_diff(before, after)

    assert summary == {"added": 0, "removed": 0, "changed": 0, "moved": 1, "total": 1}
    assert len(changes) == 1
    assert changes[0]["kind"] == "moved"
    assert changes[0]["moved"] is True
