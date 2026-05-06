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
from app.services.staff_import import generate_temporary_password
from app.services.user_admin import set_temporary_password, set_user_active, set_user_password


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage NewscastNavigator users")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("list", help="List users")

    create_user = subparsers.add_parser("create-user", help="Create a user with a temporary password")
    create_user.add_argument("username")
    create_user.add_argument("--role", default="author")
    create_user.add_argument("--full-name", default="")
    create_user.add_argument("--job-title", default="")
    create_user.add_argument("--temporary-password", dest="temporary_password")

    set_password = subparsers.add_parser("set-password", help="Set password for a user")
    set_password.add_argument("username")
    set_password.add_argument("--password", dest="password")

    set_temp_password = subparsers.add_parser(
        "set-temp-password",
        help="Set temporary password for a user and require password change on next login",
    )
    set_temp_password.add_argument("username")
    set_temp_password.add_argument("--password", dest="password")

    deactivate = subparsers.add_parser("deactivate", help="Deactivate a user")
    deactivate.add_argument("username")

    activate = subparsers.add_parser("activate", help="Activate a user")
    activate.add_argument("username")

    return parser


def _load_user(username: str) -> User:
    with SessionLocal() as db:
        user = db.execute(select(User).where(User.username == username)).scalar_one_or_none()
        if user is None:
            raise SystemExit(f"User not found: {username}")
        db.expunge(user)
        return user


def _list_users() -> int:
    with SessionLocal() as db:
        rows = db.execute(select(User).order_by(User.id.asc())).scalars().all()
        for row in rows:
            print(
                f"{row.id}\t{row.username}\trole={row.role}\tactive={'yes' if row.is_active else 'no'}"
                f"\tmust_change={'yes' if row.must_change_password else 'no'}"
                f"\tfull_name={row.full_name or '-'}\tjob_title={row.job_title or '-'}"
            )
    return 0


def _create_user(
    username: str,
    *,
    role: str,
    full_name: str,
    job_title: str,
    temporary_password: str | None,
) -> int:
    normalized_username = username.strip()
    if not normalized_username:
        raise SystemExit("Username cannot be empty")

    with SessionLocal() as db:
        existing = db.execute(
            select(User).where(User.username == normalized_username)
        ).scalar_one_or_none()
        if existing is not None:
            raise SystemExit(f"User already exists: {normalized_username}")

        user = User(
            username=normalized_username,
            full_name=full_name.strip() or None,
            job_title=job_title.strip() or None,
            role=role.strip().lower() or "author",
            is_active=True,
            must_change_password=True,
            password_hash="",
        )
        db.add(user)
        db.flush()

        target_password = temporary_password or generate_temporary_password()
        set_temporary_password(db, user, target_password)
        print(f"User created: {user.username}")
        print(target_password)
    return 0


def _set_password(username: str, password: str | None) -> int:
    with SessionLocal() as db:
        user = db.execute(select(User).where(User.username == username)).scalar_one_or_none()
        if user is None:
            raise SystemExit(f"User not found: {username}")

        target_password = password
        if not target_password:
            first = getpass.getpass("New password: ")
            second = getpass.getpass("Repeat new password: ")
            if first != second:
                raise SystemExit("Passwords do not match")
            target_password = first

        set_user_password(db, user, target_password)
        print(f"Password updated for user: {user.username}")
    return 0


def _set_activation(username: str, *, is_active: bool) -> int:
    with SessionLocal() as db:
        user = db.execute(select(User).where(User.username == username)).scalar_one_or_none()
        if user is None:
            raise SystemExit(f"User not found: {username}")

        set_user_active(db, user, is_active=is_active)
        state = "active" if is_active else "inactive"
        print(f"User {user.username} is now {state}")
    return 0


def _set_temporary_password(username: str, password: str | None) -> int:
    with SessionLocal() as db:
        user = db.execute(select(User).where(User.username == username)).scalar_one_or_none()
        if user is None:
            raise SystemExit(f"User not found: {username}")

        target_password = password or generate_temporary_password()
        set_temporary_password(db, user, target_password)
        print(f"Temporary password set for user: {user.username}")
        print(target_password)
    return 0


def main() -> int:
    args = _build_parser().parse_args()

    if args.command == "list":
        return _list_users()
    if args.command == "create-user":
        return _create_user(
            args.username,
            role=args.role,
            full_name=args.full_name,
            job_title=args.job_title,
            temporary_password=args.temporary_password,
        )
    if args.command == "set-password":
        return _set_password(args.username, args.password)
    if args.command == "set-temp-password":
        return _set_temporary_password(args.username, args.password)
    if args.command == "deactivate":
        return _set_activation(args.username, is_active=False)
    if args.command == "activate":
        return _set_activation(args.username, is_active=True)

    raise SystemExit(f"Unknown command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
