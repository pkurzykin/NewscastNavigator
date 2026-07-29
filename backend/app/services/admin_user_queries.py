from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.models import User
from app.domain.codes import FUNCTION_CODE_ORDER, FUNCTION_LABELS
from app.schemas.admin import AdminUserItem, AdminUsersResponse
from app.schemas.stories import CodeLabel


def list_admin_users(db: Session) -> AdminUsersResponse:
    users = db.execute(select(User).options(selectinload(User.functions))).scalars().all()
    users.sort(key=lambda user: (not user.is_active, user.display_name.casefold(), user.id))
    return AdminUsersResponse(
        items=[AdminUserItem.model_validate(user) for user in users],
        function_options=[
            CodeLabel(code=code, label=FUNCTION_LABELS[code]) for code in FUNCTION_CODE_ORDER
        ],
    )
