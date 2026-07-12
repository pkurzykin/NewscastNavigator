from __future__ import annotations

from app.db.models import Story, User
from app.services.permissions import is_leadership


def can_update_story_metadata(user: User, story: Story) -> bool:
    return user.is_active and (is_leadership(user) or story.author_user_id == user.id)
