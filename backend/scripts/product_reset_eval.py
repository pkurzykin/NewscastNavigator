from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.product_reset_eval import (  # noqa: E402
    evaluate_verification,
    load_eval_result,
    run_checkpoint,
)


def _repo_root(value: str) -> Path:
    path = Path(value).expanduser().resolve()
    if not (path / "docs/product-reset/EVAL_RESULT.json").is_file():
        raise argparse.ArgumentTypeError(f"это не корень репозитория Product Reset: {path}")
    return path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Запуск и проверка свидетельств Product Reset")
    subparsers = parser.add_subparsers(dest="command", required=True)

    run_parser = subparsers.add_parser("run", help="обновить машиночитаемые свидетельства checkpoint")
    run_parser.add_argument("--checkpoint", required=True)
    run_parser.add_argument("--repo-root", required=True, type=_repo_root)

    verify_parser = subparsers.add_parser("verify", help="проверить свидетельства checkpoint или final")
    verify_parser.add_argument("--scope", required=True, choices=("checkpoint", "final"))
    verify_parser.add_argument("--checkpoint")
    verify_parser.add_argument("--repo-root", required=True, type=_repo_root)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.command == "run":
        document = run_checkpoint(args.repo_root, args.checkpoint)
        print(json.dumps({"checkpoint": document["checkpoint"], "commit": document["commit"]}))
        return 0

    if args.scope == "checkpoint" and not args.checkpoint:
        print("--checkpoint обязателен при --scope checkpoint", file=sys.stderr)
        return 1

    result_path = args.repo_root / "docs/product-reset/EVAL_RESULT.json"
    try:
        document = load_eval_result(result_path)
        verification = evaluate_verification(
            document,
            scope=args.scope,
            checkpoint=args.checkpoint,
        )
    except ValueError as exc:
        print(json.dumps({"passed": False, "errors": [str(exc)]}, ensure_ascii=False))
        return 1

    print(
        json.dumps(
            {
                "scope": verification.scope,
                "checkpoint": verification.checkpoint,
                "passed": verification.passed,
                "errors": list(verification.errors),
            },
            ensure_ascii=False,
        )
    )
    return 0 if verification.passed else 2


if __name__ == "__main__":
    raise SystemExit(main())
