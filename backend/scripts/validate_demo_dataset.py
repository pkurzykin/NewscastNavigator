from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.demo_dataset_validation import build_validation_report


def _read_json(input_path: str) -> object:
    if input_path == "-":
        return json.load(sys.stdin)
    with Path(input_path).open(encoding="utf-8") as source:
        return json.load(source)


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate a sanitized demo dataset")
    parser.add_argument("--input", required=True)
    parser.add_argument("--report")
    args = parser.parse_args()

    report = build_validation_report(_read_json(args.input))
    rendered = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.report:
        report_path = Path(args.report)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(rendered, encoding="utf-8")
    sys.stdout.write(rendered)
    return 0 if report["valid"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
