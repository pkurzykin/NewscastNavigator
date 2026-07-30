from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path

from sqlalchemy import select


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.db.models import User
from app.db.session import SessionLocal
from app.services.user_admin import (
    normalize_identity_value,
    set_temporary_password,
    set_user_active,
    set_user_functions,
    set_user_password,
)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Управление пользователями NewscastNavigator")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("list")
    create = commands.add_parser("create-user")
    create.add_argument("username")
    create.add_argument("--display-name", required=True)
    create.add_argument("--position", required=True)
    create.add_argument("--function", action="append", dest="functions", required=True)
    create.add_argument("--temporary-password")
    for name in ("set-password", "set-temp-password", "activate", "deactivate"):
        item = commands.add_parser(name)
        item.add_argument("username")
        if name in {"set-password", "set-temp-password"}:
            item.add_argument("--password")
    return parser


def _find(db, username: str) -> User:
    normalized_username = _identity(username, field_name="username")
    user = db.execute(
        select(User).where(User.username == normalized_username)
    ).scalar_one_or_none()
    if user is None:
        raise SystemExit(f"Пользователь не найден: {normalized_username}")
    return user


def _identity(value: object, *, field_name: str) -> str:
    try:
        return normalize_identity_value(value, field_name=field_name)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc


def _password(value: str | None) -> str:
    if value:
        return value
    first = getpass.getpass("Пароль: ")
    second = getpass.getpass("Повтор пароля: ")
    if first != second:
        raise SystemExit("Пароли не совпадают")
    return first


def main() -> int:
    args = _parser().parse_args()
    with SessionLocal() as db:
        if args.command == "list":
            for user in db.execute(select(User).order_by(User.id)).scalars():
                print(
                    f"{user.id}\t{user.username}\tактивен={'да' if user.is_active else 'нет'}"
                    f"\tфункции={','.join(user.function_codes)}\tимя={user.display_name}"
                    f"\tдолжность={user.position}"
                )
            return 0
        if args.command == "create-user":
            username = _identity(args.username, field_name="username")
            display_name = _identity(args.display_name, field_name="display_name")
            position = _identity(args.position, field_name="position")
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
            set_user_functions(user, tuple(args.functions))
            db.add(user)
            db.flush()
            set_temporary_password(db, user, _password(args.temporary_password))
            db.commit()
            print(f"Пользователь создан: {user.username}")
            return 0
        user = _find(db, args.username)
        if args.command == "set-password":
            set_user_password(db, user, _password(args.password))
        elif args.command == "set-temp-password":
            set_temporary_password(db, user, _password(args.password))
        elif args.command == "activate":
            set_user_active(db, user, is_active=True)
        elif args.command == "deactivate":
            set_user_active(db, user, is_active=False)
        db.commit()
        print(f"Пользователь обновлён: {user.username}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
