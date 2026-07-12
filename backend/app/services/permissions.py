from __future__ import annotations

from collections.abc import Iterable

from app.db.models import User
from app.domain.codes import LEADERSHIP_FUNCTION_CODES


def get_function_codes(user: User) -> frozenset[str]:
    if not user.is_active:
        return frozenset()
    return frozenset(item.function_code for item in user.functions)


def has_function(user: User, function_code: str) -> bool:
    return function_code in get_function_codes(user)


def has_any_function(user: User, function_codes: Iterable[str]) -> bool:
    return bool(get_function_codes(user).intersection(function_codes))


def is_leadership(user: User) -> bool:
    return has_any_function(user, LEADERSHIP_FUNCTION_CODES)


def can_manage_users(user: User) -> bool:
    return has_function(user, "chief")


def can_create_story(user: User) -> bool:
    return has_any_function(user, {"author", "chief"})
