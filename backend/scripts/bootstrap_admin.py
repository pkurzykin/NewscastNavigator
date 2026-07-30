from __future__ import annotations

import os
import sys
from pathlib import Path

from sqlalchemy import select


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.db.models import User
from app.db.session import SessionLocal
from app.services.runtime_setup import initialize_runtime
from app.services.user_admin import set_temporary_password, set_user_functions


def _required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"Не задана обязательная переменная окружения: {name}")
    return value


def _required_password_env(name: str) -> str:
    value = os.environ.get(name)
    if value is None or not value.strip():
        raise SystemExit(f"Не задана обязательная переменная окружения: {name}")
    return value


def main() -> int:
    username = _required_env("BOOTSTRAP_ADMIN_USERNAME")
    display_name = _required_env("BOOTSTRAP_ADMIN_DISPLAY_NAME")
    position = _required_env("BOOTSTRAP_ADMIN_POSITION")
    password = _required_password_env("BOOTSTRAP_ADMIN_PASSWORD")
    initialize_runtime(seed_demo_records=False)
    with SessionLocal() as db:
        if db.execute(select(User).where(User.username == username)).scalar_one_or_none():
            raise SystemExit(f"Пользователь уже существует: {username}")
        user = User(
            username=username,
            display_name=display_name,
            position=position,
            password_hash="",
            is_active=True,
            must_change_password=True,
        )
        set_user_functions(user, ("chief",))
        db.add(user)
        db.flush()
        set_temporary_password(db, user, password)
        db.commit()
    print(f"Пользователь с функцией начальника создан: {username}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
