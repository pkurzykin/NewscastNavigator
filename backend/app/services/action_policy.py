from __future__ import annotations

from app.db.models import Story, StoryWorkflowState, User
from app.schemas.common import ActionRef
from app.services.permissions import has_function, is_leadership


def can_update_story_metadata(user: User, story: Story) -> bool:
    return user.is_active and (is_leadership(user) or story.author_user_id == user.id)


def _workflow_action(story_id: int, code: str, label: str) -> ActionRef:
    path_codes = {
        "submit_review": "submit-review",
        "confirm_editorial": "confirm-editorial",
        "mark_proofread": "mark-proofread",
        "request_reproofread": "request-reproofread",
    }
    return ActionRef(
        code=code,
        label=label,
        method="POST",
        href=f"/api/v1/stories/{story_id}/workflow/{path_codes[code]}",
    )


def editorial_workflow_actions(
    *,
    user: User,
    story: Story,
    state: StoryWorkflowState,
    assigned_proofreader_user_id: int | None,
) -> tuple[ActionRef | None, list[ActionRef]]:
    if story.archived_at is not None:
        return None, []

    actions: list[ActionRef] = []
    leadership = is_leadership(user)
    is_author = user.id == story.author_user_id
    is_assigned_proofreader = user.id == assigned_proofreader_user_id

    if state.editorial_revision is None:
        if is_author and leadership:
            actions.append(_workflow_action(story.id, "confirm_editorial", "Текст готов"))
        elif (is_author or has_function(user, "chief")) and state.review_requested_revision is None:
            actions.append(_workflow_action(story.id, "submit_review", "Отправить на проверку"))
        elif leadership and state.review_requested_revision is not None:
            actions.append(
                _workflow_action(
                    story.id,
                    "confirm_editorial",
                    "Подтвердить редакционную готовность",
                )
            )

    proofread_needed = state.proofread_revision is None or state.reproofread_requested_revision is not None
    if (is_assigned_proofreader or leadership) and proofread_needed:
        actions.append(_workflow_action(story.id, "mark_proofread", "Вычитано"))
    if (
        leadership
        and state.proofread_revision is not None
        and state.changed_after_proofread
        and state.reproofread_requested_revision is None
    ):
        actions.append(
            _workflow_action(story.id, "request_reproofread", "Назначить повторную вычитку")
        )

    if not actions:
        return None, []
    primary = actions[0].model_copy(update={"emphasis": "primary"})
    return primary, actions[1:]
