from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.db.session import SessionLocal
from app.services.runtime_setup import initialize_runtime
from app.services.staff_import import import_staff_users, load_staff_rows_from_xlsx


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Import newsroom staff from XLSX")
    parser.add_argument("xlsx_path")
    parser.add_argument(
        "--reset-existing-passwords",
        action="store_true",
        help="Reset temporary passwords for already existing imported users too",
    )
    parser.add_argument(
        "--report",
        dest="report_path",
        default="",
        help="Optional TSV file with usernames and temporary passwords",
    )
    return parser


def main() -> int:
    args = _build_parser().parse_args()
    initialize_runtime(seed_demo_records=False)
    rows = load_staff_rows_from_xlsx(args.xlsx_path)
    with SessionLocal() as db:
        result = import_staff_users(
            db,
            rows=rows,
            reset_existing_passwords=args.reset_existing_passwords,
        )

    report_lines = ["username\tfull_name\tjob_title\trole\ttemporary_password"]
    for item in result:
        report_lines.append(
            f"{item.username}\t{item.full_name}\t{item.job_title}\t{item.role}\t{item.temporary_password or ''}"
        )

    if args.report_path:
        report_path = Path(args.report_path).expanduser().resolve()
        report_path.write_text("\n".join(report_lines) + "\n", encoding="utf-8")
        print(f"Report written to: {report_path}")
    else:
        for line in report_lines:
            print(line)

    created_count = sum(1 for item in result if item.created)
    updated_count = len(result) - created_count
    password_count = sum(1 for item in result if item.temporary_password)
    print(
        f"Imported users: total={len(result)} created={created_count} updated={updated_count} temporary_passwords={password_count}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
