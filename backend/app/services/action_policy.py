from __future__ import annotations

from app.db.models import Story, StoryProductionState, StoryWorkflowState, User
from app.schemas.common import ActionRef
from app.services.permissions import can_work_assigned_track, has_function, is_leadership


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


def _production_action(
    story_id: int,
    code: str,
    label: str,
    path: str,
    *,
    form: str | None = None,
) -> ActionRef:
    return ActionRef(
        code=code,
        label=label,
        method="POST",
        href=f"/api/v1/stories/{story_id}/production/{path}",
        form=form,
    )


def _correction_package_action(story_id: int, code: str, label: str) -> ActionRef:
    return ActionRef(
        code=code,
        label=label,
        method="POST",
        href=f"/api/v1/stories/{story_id}/correction-packages",
        form="correction_package",
    )


def production_actions(
    *,
    user: User,
    story: Story,
    workflow: StoryWorkflowState,
    production: StoryProductionState,
    assigned_video_editor_user_id: int | None,
    assigned_designer_user_id: int | None,
    has_pending_voiceover_correction: bool,
    has_pending_video_correction: bool,
    has_pending_titles_correction: bool,
) -> tuple[ActionRef | None, list[ActionRef]]:
    if story.archived_at is not None or not user.is_active:
        return None, []

    actions: list[ActionRef] = []
    leadership = is_leadership(user)
    if production.voiceover_ready:
        if leadership:
            actions.append(
                _production_action(
                    story.id,
                    "voiceover_not_ready",
                    "Вернуть озвучку в работу",
                    "voiceover/not-ready",
                    form="correction_package",
                )
            )
    elif not has_pending_voiceover_correction:
        actions.append(
            _production_action(
                story.id,
                "voiceover_ready",
                "Озвучка готова",
                "voiceover/ready",
            )
        )

    can_video = can_work_assigned_track(
        user,
        assigned_user_id=assigned_video_editor_user_id,
    )
    if can_video and production.video_started_at is None:
        actions.append(
            _production_action(story.id, "video_start", "Начать монтаж", "video/start")
        )
    elif (
        can_video
        and production.video_ready_at is None
        and production.video_started_at is not None
        and not has_pending_video_correction
    ):
        actions.append(
            _production_action(story.id, "video_ready", "Ролик готов", "video/ready")
        )

    if (
        leadership
        and production.video_ready_at is not None
        and production.video_approved_for_titles_at is None
        and workflow.editorial_revision is not None
        and workflow.proofread_revision is not None
        and not has_pending_video_correction
    ):
        actions.append(
            _production_action(
                story.id,
                "video_approve_for_titles",
                "Ролик готов к титрам",
                "video/approve-for-titles",
            )
        )
    if leadership and production.video_ready_at is not None and not has_pending_video_correction:
        actions.append(
            _correction_package_action(
                story.id,
                "video_correction_package",
                "Вернуть ролик на правки",
            )
        )

    titles_gate = (
        workflow.editorial_revision is not None
        and workflow.proofread_revision is not None
        and production.video_approved_for_titles_at is not None
    )
    can_titles = can_work_assigned_track(
        user,
        assigned_user_id=assigned_designer_user_id,
    )
    if (
        can_titles
        and titles_gate
        and production.titles_started_at is None
    ):
        actions.append(
            _production_action(story.id, "titles_start", "Начать титры", "titles/start")
        )
    elif (
        can_titles
        and production.titles_started_at is not None
        and production.titles_ready_at is None
        and not has_pending_titles_correction
    ):
        actions.append(
            _production_action(story.id, "titles_ready", "Титры готовы", "titles/ready")
        )
    if (
        leadership
        and production.titles_ready_at is not None
        and production.titles_accepted_at is None
        and not has_pending_titles_correction
    ):
        actions.append(
            _production_action(story.id, "titles_accept", "Принять титры", "titles/accept")
        )
    if leadership and production.titles_ready_at is not None and not has_pending_titles_correction:
        actions.append(
            _correction_package_action(
                story.id,
                "titles_correction_package",
                "Вернуть титры на правки",
            )
        )

    if not actions:
        return None, []
    return actions[0].model_copy(update={"emphasis": "primary"}), actions[1:]
