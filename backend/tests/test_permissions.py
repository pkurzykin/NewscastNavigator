from __future__ import annotations

from app.db.models import User, UserFunction
from app.services.permissions import (
    can_create_story,
    can_manage_users,
    get_function_codes,
    has_any_function,
    has_function,
    is_leadership,
)


def _user(*functions: str, active: bool = True) -> User:
    user = User(
        username="synthetic",
        display_name="Астра",
        position="Сотрудник",
        password_hash="unused",
        is_active=active,
    )
    user.functions = [UserFunction(function_code=code) for code in functions]
    return user


def test_permissions_union_all_user_functions_without_current_role() -> None:
    user = _user("author", "proofreader")

    assert get_function_codes(user) == frozenset({"author", "proofreader"})
    assert has_function(user, "author") is True
    assert has_function(user, "proofreader") is True
    assert has_any_function(user, {"chief", "proofreader"}) is True
    assert can_create_story(user) is True


def test_leadership_and_user_management_are_distinct() -> None:
    chief = _user("chief")
    chief_editor = _user("chief_editor")

    assert is_leadership(chief) is True
    assert is_leadership(chief_editor) is True
    assert can_manage_users(chief) is True
    assert can_manage_users(chief_editor) is False


def test_inactive_user_has_no_effective_permissions() -> None:
    user = _user("chief", "author", active=False)

    assert get_function_codes(user) == frozenset()
    assert is_leadership(user) is False
    assert can_manage_users(user) is False
