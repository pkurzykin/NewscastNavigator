from __future__ import annotations

import sys
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.runtime_setup import initialize_runtime


def main() -> int:
    initialize_runtime(seed_demo_records=True)
    print("Синтетические демонстрационные данные готовы")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
