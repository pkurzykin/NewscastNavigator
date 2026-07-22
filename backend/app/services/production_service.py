from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    CorrectionPackage,
    CorrectionPart,
    Rubric,
    Scenario,
    ScenarioReadMarker,
    Story,
    StoryAssignment,
    StoryEvent,
    StoryMaterialLink,
    StoryProductionState,
    StoryWorkflowState,
    User,
)
from app.domain.codes import ASSIGNMENT_KINDS
from app.schemas.common import CommandAck, ResourceRef
from app.schemas.production import (
    AiredRef,
    MaterialRef,
    ProductionReadResponse,
    ProductionStageRef,
    StoryHeader,
    TitlesReadState,
    VideoReadState,
    VoiceoverReadState,
)
from app.schemas.stories import AssignmentRef, CodeLabel, RubricRef, UserRef
from app.services.action_policy import production_actions
from app.services.correction_service import (
    CorrectionPartInput,
    create_correction_package_rows,
    get_correction_summary,
)
from app.services.permissions import (
    can_manage_assignments,
    can_work_assigned_track,
    has_function,
    is_leadership,
)


ASSIGNMENT_ORDER = {"proofreader": 0, "video_editor": 1, "designer": 2}
PRIORITY_LABELS = {"standard": "Стандарт", "high": "Высокий"}


def _error(code: str, message: str, http_status: int = status.HTTP_409_CONFLICT) -> HTTPException:
    return HTTPException(status_code=http_status, detail={"code": code, "message": message})


def _user_ref(user: User | None) -> UserRef | None:
    if user is None:
        return None
    return UserRef(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        position=user.position,
        function_codes=user.function_codes,
    )


@dataclass(frozen=True)
class ProductionContext:
    story: Story
    scenario: Scenario
    workflow: StoryWorkflowState
    production: StoryProductionState


def _context(db: Session, *, story_id: int, for_update: bool) -> ProductionContext:
    story = db.get(Story, story_id)
    if story is None:
        raise _error("STORY_NOT_FOUND", "Сюжет не найден", status.HTTP_404_NOT_FOUND)

    scenario_query = select(Scenario).where(Scenario.story_id == story_id)
    workflow_query = select(StoryWorkflowState).where(StoryWorkflowState.story_id == story_id)
    production_query = select(StoryProductionState).where(StoryProductionState.story_id == story_id)
    if for_update:
        scenario_query = scenario_query.with_for_update()
        workflow_query = workflow_query.with_for_update()
        production_query = production_query.with_for_update()

    # Lock ordering is shared with scenario/workflow commands.
    scenario = db.scalar(scenario_query)
    workflow = db.scalar(workflow_query)
    production = db.scalar(production_query)
    if scenario is None:
        raise _error("SCENARIO_NOT_FOUND", "У сюжета нет сценария", status.HTTP_404_NOT_FOUND)
    if workflow is None or production is None:
        raise _error("INVALID_TRANSITION", "Состояние производства не создано")
    return ProductionContext(
        story=story,
        scenario=scenario,
        workflow=workflow,
        production=production,
    )


def _require_mutable(context: ProductionContext) -> None:
    if context.story.archived_at is not None:
        raise _error("STORY_ARCHIVED", "Архивный сюжет нельзя изменять")


def _record_event(
    db: Session,
    *,
    context: ProductionContext,
    actor: User,
    event_code: str,
    now: datetime,
    payload: dict[str, object] | None = None,
) -> StoryEvent:
    event = StoryEvent(
        story_id=context.story.id,
        event_code=event_code,
        actor_user_id=actor.id,
        revision_no=context.scenario.revision_no,
        payload=payload or {},
        created_at=now,
    )
    db.add(event)
    db.flush()
    return event


def _ack(
    db: Session,
    *,
    event: StoryEvent,
    changed_at: datetime,
    resource_type: str,
    resource_id: int,
) -> CommandAck:
    db.commit()
    return CommandAck(
        event_id=str(event.id),
        changed_at=changed_at,
        resource=ResourceRef(type=resource_type, id=resource_id),
    )


def _assignments(
    db: Session,
    story_id: int,
    *,
    for_update: bool = False,
) -> list[StoryAssignment]:
    statement = (
        select(StoryAssignment)
        .where(StoryAssignment.story_id == story_id)
        .order_by(StoryAssignment.kind.asc(), StoryAssignment.id.asc())
    )
    if for_update:
        statement = statement.with_for_update()
    return list(
        db.execute(statement).scalars()
    )


def _assignment_ids(assignments: list[StoryAssignment]) -> dict[str, int]:
    return {assignment.kind: assignment.user_id for assignment in assignments}


def _has_pending_correction(
    db: Session,
    *,
    story_id: int,
    scope: str,
    for_update: bool,
) -> bool:
    statement = (
        select(CorrectionPackage.id)
        .join(CorrectionPart, CorrectionPart.package_id == CorrectionPackage.id)
        .where(
            CorrectionPackage.story_id == story_id,
            CorrectionPackage.closed_at.is_(None),
            CorrectionPart.scope == scope,
            CorrectionPart.state == "pending",
        )
        .limit(1)
    )
    if for_update:
        statement = statement.with_for_update()
    return db.scalar(statement) is not None


def _load_users(db: Session, user_ids: set[int | None]) -> dict[int, User]:
    actual_ids = {user_id for user_id in user_ids if user_id is not None}
    if not actual_ids:
        return {}
    return {
        user.id: user
        for user in db.execute(select(User).where(User.id.in_(actual_ids))).scalars().all()
    }


def _stage_refs(context: ProductionContext, users: dict[int, User]) -> list[ProductionStageRef]:
    production = context.production
    workflow = context.workflow
    if production.voiceover_ready:
        voiceover_actor = users.get(production.voiceover_ready_by_user_id or -1)
        voiceover_summary = "Готова"
        if voiceover_actor is not None:
            voiceover_summary = f"Готова · {voiceover_actor.display_name}"
        voiceover_stage = ProductionStageRef(
            code="voiceover", state="ready", label="Озвучка", summary=voiceover_summary
        )
    else:
        voiceover_stage = ProductionStageRef(
            code="voiceover", state="pending", label="Озвучка", summary="Не готова"
        )

    if production.video_approved_for_titles_at is not None:
        video_stage = ProductionStageRef(
            code="video", state="approved", label="Монтаж", summary="Ролик готов к титрам"
        )
    elif production.video_ready_at is not None:
        video_stage = ProductionStageRef(
            code="video", state="ready", label="Монтаж", summary="Ролик готов · ожидает просмотра"
        )
    elif production.video_started_at is not None:
        video_stage = ProductionStageRef(
            code="video", state="in_progress", label="Монтаж", summary="Монтаж в работе"
        )
    else:
        video_stage = ProductionStageRef(
            code="video", state="pending", label="Монтаж", summary="Монтаж не начат"
        )

    titles_gate = (
        workflow.editorial_revision is not None
        and workflow.proofread_revision is not None
        and production.video_approved_for_titles_at is not None
    )
    if production.titles_accepted_at is not None:
        titles_stage = ProductionStageRef(
            code="titles", state="accepted", label="Титры", summary="Титры приняты"
        )
    elif production.titles_ready_at is not None:
        titles_stage = ProductionStageRef(
            code="titles", state="ready", label="Титры", summary="Титры готовы · ожидают приёмки"
        )
    elif production.titles_started_at is not None:
        titles_stage = ProductionStageRef(
            code="titles", state="in_progress", label="Титры", summary="Титры в работе"
        )
    elif titles_gate:
        titles_stage = ProductionStageRef(
            code="titles", state="available", label="Титры", summary="Можно начинать титры"
        )
    else:
        titles_stage = ProductionStageRef(
            code="titles",
            state="pending",
            label="Титры",
            summary="Ожидают редакционную готовность, корректуру и допуск ролика",
        )
    return [voiceover_stage, video_stage, titles_stage]


def _track_marker(
    db: Session,
    *,
    story_id: int,
    user_id: int,
    context: str,
) -> ScenarioReadMarker | None:
    return db.scalar(
        select(ScenarioReadMarker).where(
            ScenarioReadMarker.story_id == story_id,
            ScenarioReadMarker.user_id == user_id,
            ScenarioReadMarker.context == context,
        )
    )


def _latest_revision(*revisions: int | None) -> int | None:
    actual = [revision for revision in revisions if revision is not None]
    return max(actual) if actual else None


def _production_situation(context: ProductionContext) -> CodeLabel:
    story = context.story
    production = context.production
    if story.archived_at is not None:
        return CodeLabel(code="archive", label="В архиве")
    if story.aired_at is not None:
        return CodeLabel(code="aired", label="В эфире")
    if production.titles_accepted_at is not None:
        return CodeLabel(code="titles_accepted", label="Титры приняты")
    if production.titles_ready_at is not None:
        return CodeLabel(code="titles_ready", label="Титры готовы · ожидают приёмки")
    if production.titles_started_at is not None:
        return CodeLabel(code="titles_in_progress", label="Титры в работе")
    if production.video_approved_for_titles_at is not None:
        return CodeLabel(code="video_approved", label="Ролик готов к титрам")
    if production.video_ready_at is not None:
        return CodeLabel(code="video_ready", label="Ролик готов · ожидает просмотра")
    if production.video_started_at is not None:
        return CodeLabel(code="video_in_progress", label="Монтаж в работе")
    if production.voiceover_ready:
        return CodeLabel(code="voiceover_ready", label="Озвучка готова")
    return CodeLabel(code="production_pending", label="Производство не начато")


def get_production_read_model(
    db: Session,
    *,
    story_id: int,
    actor: User,
) -> ProductionReadResponse:
    context = _context(db, story_id=story_id, for_update=False)
    assignments = _assignments(db, story_id)
    assignment_ids = _assignment_ids(assignments)
    materials = list(
        db.execute(
            select(StoryMaterialLink)
            .where(StoryMaterialLink.story_id == story_id)
            .order_by(StoryMaterialLink.added_at.asc(), StoryMaterialLink.id.asc())
        ).scalars()
    )
    rubric = db.get(Rubric, context.story.rubric_id)
    author = db.get(User, context.story.author_user_id)
    if rubric is None or author is None:
        raise _error("STORY_NOT_FOUND", "Сюжет не найден", status.HTTP_404_NOT_FOUND)

    user_ids: set[int | None] = {
        context.story.author_user_id,
        context.story.aired_by_user_id,
        context.production.voiceover_ready_by_user_id,
        context.production.video_started_by_user_id,
        context.production.video_ready_by_user_id,
        context.production.video_approved_for_titles_by_user_id,
        context.production.titles_started_by_user_id,
        context.production.titles_ready_by_user_id,
        context.production.titles_accepted_by_user_id,
        *(assignment.user_id for assignment in assignments),
        *(material.added_by_user_id for material in materials),
    }
    users = _load_users(db, user_ids)
    assignment_refs = [
        AssignmentRef(kind=item.kind, user=_user_ref(users[item.user_id]))  # type: ignore[arg-type]
        for item in sorted(assignments, key=lambda item: (ASSIGNMENT_ORDER[item.kind], item.id))
    ]
    pending_voiceover = _has_pending_correction(
        db, story_id=story_id, scope="voiceover", for_update=False
    )
    pending_video = _has_pending_correction(db, story_id=story_id, scope="video", for_update=False)
    pending_titles = _has_pending_correction(db, story_id=story_id, scope="titles", for_update=False)
    primary, additional = production_actions(
        user=actor,
        story=context.story,
        workflow=context.workflow,
        production=context.production,
        assigned_video_editor_user_id=assignment_ids.get("video_editor"),
        assigned_designer_user_id=assignment_ids.get("designer"),
        has_pending_voiceover_correction=pending_voiceover,
        has_pending_video_correction=pending_video,
        has_pending_titles_correction=pending_titles,
    )

    video_marker = _track_marker(db, story_id=story_id, user_id=actor.id, context="video")
    titles_marker = _track_marker(db, story_id=story_id, user_id=actor.id, context="titles")
    video_baseline = _latest_revision(
        context.production.video_started_revision,
        video_marker.revision_no if video_marker is not None else None,
    )
    titles_baseline = _latest_revision(
        context.production.titles_started_revision,
        titles_marker.revision_no if titles_marker is not None else None,
    )
    manager = can_manage_assignments(actor) and context.story.archived_at is None
    assignee_users = []
    if manager:
        assignee_users = list(
            db.execute(
                select(User)
                .where(User.is_active.is_(True))
                .order_by(User.display_name.asc(), User.id.asc())
            ).scalars()
        )

    story_header = StoryHeader(
        id=context.story.id,
        title=context.story.title,
        priority=CodeLabel(
            code=context.story.priority,
            label=PRIORITY_LABELS[context.story.priority],
        ),
        rubric=RubricRef(id=rubric.id, name=rubric.name),
        author=_user_ref(author),  # type: ignore[arg-type]
        situation=_production_situation(context),
        assignments=assignment_refs,
        created_at=context.story.created_at,
        aired_at=context.story.aired_at,
        archived_at=context.story.archived_at,
        primary_action=primary,
        additional_actions=additional,
    )
    aired_by = users.get(context.story.aired_by_user_id or -1)
    return ProductionReadResponse(
        story=story_header,
        scenario_revision=context.scenario.revision_no,
        assignments=assignment_refs,
        assignee_options=[_user_ref(user) for user in assignee_users],  # type: ignore[list-item]
        can_manage_assignments=manager,
        materials=[
            MaterialRef(
                id=material.id,
                title=material.title,
                location=material.location,
                added_by=_user_ref(users[material.added_by_user_id]),  # type: ignore[arg-type]
                added_at=material.added_at,
            )
            for material in materials
        ],
        corrections=get_correction_summary(db, story_id=story_id),
        voiceover=VoiceoverReadState(
            ready=context.production.voiceover_ready,
            ready_by=_user_ref(users.get(context.production.voiceover_ready_by_user_id or -1)),
            ready_at=context.production.voiceover_ready_at,
        ),
        video=VideoReadState(
            started_by=_user_ref(users.get(context.production.video_started_by_user_id or -1)),
            started_at=context.production.video_started_at,
            ready_by=_user_ref(users.get(context.production.video_ready_by_user_id or -1)),
            ready_at=context.production.video_ready_at,
            approved_for_titles_by=_user_ref(users.get(context.production.video_approved_for_titles_by_user_id or -1)),
            approved_for_titles_at=context.production.video_approved_for_titles_at,
            last_opened_revision=video_marker.revision_no if video_marker is not None else None,
            has_unseen_scenario_changes=(
                context.production.video_started_revision is not None
                and video_baseline is not None
                and context.scenario.revision_no > video_baseline
            ),
        ),
        titles=TitlesReadState(
            initial_gate_satisfied=(
                context.workflow.editorial_revision is not None
                and context.workflow.proofread_revision is not None
                and context.production.video_approved_for_titles_at is not None
            ),
            started_by=_user_ref(users.get(context.production.titles_started_by_user_id or -1)),
            started_at=context.production.titles_started_at,
            ready_by=_user_ref(users.get(context.production.titles_ready_by_user_id or -1)),
            ready_at=context.production.titles_ready_at,
            accepted_by=_user_ref(users.get(context.production.titles_accepted_by_user_id or -1)),
            accepted_at=context.production.titles_accepted_at,
            last_opened_revision=titles_marker.revision_no if titles_marker is not None else None,
            has_unseen_scenario_changes=(
                context.production.titles_started_revision is not None
                and titles_baseline is not None
                and context.scenario.revision_no > titles_baseline
            ),
        ),
        aired=(
            AiredRef(by=_user_ref(aired_by), at=context.story.aired_at)  # type: ignore[arg-type]
            if aired_by is not None and context.story.aired_at is not None
            else None
        ),
        stages=_stage_refs(context, users),
        primary_action=primary,
        additional_actions=additional,
    )


def set_assignment(
    db: Session,
    *,
    story_id: int,
    actor: User,
    kind: str,
    user_id: int,
) -> CommandAck:
    context = _context(db, story_id=story_id, for_update=True)
    _require_mutable(context)
    if not can_manage_assignments(actor):
        raise _error("FORBIDDEN", "Недостаточно прав", status.HTTP_403_FORBIDDEN)
    if kind not in ASSIGNMENT_KINDS:
        raise _error(
            "ASSIGNMENT_KIND_INVALID",
            "Вид назначения не поддерживается",
            status.HTTP_422_UNPROCESSABLE_CONTENT,
        )
    assignee = db.scalar(select(User).where(User.id == user_id).with_for_update())
    if assignee is None or not assignee.is_active:
        raise _error("USER_INACTIVE", "Пользователь неактивен")
    if not has_function(assignee, kind):
        raise _error(
            "ASSIGNEE_FUNCTION_MISMATCH",
            "Функция пользователя не соответствует назначению",
            status.HTTP_422_UNPROCESSABLE_CONTENT,
        )
    assignment = db.scalar(
        select(StoryAssignment)
        .where(StoryAssignment.story_id == story_id, StoryAssignment.kind == kind)
        .with_for_update()
    )
    now = datetime.now(UTC)
    if assignment is None:
        assignment = StoryAssignment(
            story_id=story_id,
            kind=kind,
            user_id=user_id,
            assigned_by_user_id=actor.id,
            assigned_at=now,
        )
        db.add(assignment)
    else:
        assignment.user_id = user_id
        assignment.assigned_by_user_id = actor.id
        assignment.assigned_at = now
    db.flush()
    event = _record_event(
        db,
        context=context,
        actor=actor,
        event_code="assignment_set",
        now=now,
        payload={"kind": kind, "user_id": user_id},
    )
    return _ack(
        db,
        event=event,
        changed_at=now,
        resource_type="story_assignment",
        resource_id=assignment.id,
    )


def delete_assignment(
    db: Session,
    *,
    story_id: int,
    actor: User,
    kind: str,
) -> CommandAck:
    context = _context(db, story_id=story_id, for_update=True)
    _require_mutable(context)
    if not can_manage_assignments(actor):
        raise _error("FORBIDDEN", "Недостаточно прав", status.HTTP_403_FORBIDDEN)
    if kind not in ASSIGNMENT_KINDS:
        raise _error(
            "ASSIGNMENT_KIND_INVALID",
            "Вид назначения не поддерживается",
            status.HTTP_422_UNPROCESSABLE_CONTENT,
        )
    assignment = db.scalar(
        select(StoryAssignment)
        .where(StoryAssignment.story_id == story_id, StoryAssignment.kind == kind)
        .with_for_update()
    )
    if assignment is None:
        raise _error("ASSIGNMENT_NOT_FOUND", "Назначение не найдено", status.HTTP_404_NOT_FOUND)
    assignment_id = assignment.id
    db.delete(assignment)
    now = datetime.now(UTC)
    event = _record_event(
        db,
        context=context,
        actor=actor,
        event_code="assignment_removed",
        now=now,
        payload={"kind": kind},
    )
    return _ack(
        db,
        event=event,
        changed_at=now,
        resource_type="story_assignment",
        resource_id=assignment_id,
    )


def add_material(
    db: Session,
    *,
    story_id: int,
    actor: User,
    title: str,
    location: str,
) -> CommandAck:
    context = _context(db, story_id=story_id, for_update=True)
    _require_mutable(context)
    normalized_location = location.strip()
    if not normalized_location or "\x00" in normalized_location:
        raise _error(
            "MATERIAL_LOCATION_INVALID",
            "Укажите корректный внешний путь или ссылку",
            status.HTTP_422_UNPROCESSABLE_CONTENT,
        )
    now = datetime.now(UTC)
    material = StoryMaterialLink(
        story_id=story_id,
        title=title.strip(),
        location=normalized_location,
        added_by_user_id=actor.id,
        added_at=now,
    )
    db.add(material)
    db.flush()
    event = _record_event(
        db,
        context=context,
        actor=actor,
        event_code="material_added",
        now=now,
        payload={"material_id": material.id},
    )
    return _ack(
        db,
        event=event,
        changed_at=now,
        resource_type="story_material",
        resource_id=material.id,
    )


def run_production_command(
    db: Session,
    *,
    story_id: int,
    actor: User,
    command: str,
    revision: int | None = None,
    description: str | None = None,
    assignee_user_id: int | None = None,
) -> CommandAck:
    context = _context(db, story_id=story_id, for_update=True)
    _require_mutable(context)
    assignments = _assignment_ids(_assignments(db, story_id, for_update=True))
    leadership = is_leadership(actor)
    can_video = can_work_assigned_track(actor, assigned_user_id=assignments.get("video_editor"))
    can_titles = can_work_assigned_track(actor, assigned_user_id=assignments.get("designer"))

    if command == "voiceover-not-ready" and not leadership:
        raise _error("FORBIDDEN", "Недостаточно прав", status.HTTP_403_FORBIDDEN)
    if command in {"video-start", "video-ready"} and not can_video:
        raise _error("FORBIDDEN", "Недостаточно прав", status.HTTP_403_FORBIDDEN)
    if command == "video-approve-for-titles" and not leadership:
        raise _error("FORBIDDEN", "Недостаточно прав", status.HTTP_403_FORBIDDEN)
    if command in {"titles-start", "titles-ready"} and not can_titles:
        raise _error("FORBIDDEN", "Недостаточно прав", status.HTTP_403_FORBIDDEN)
    if command == "titles-accept" and not leadership:
        raise _error("FORBIDDEN", "Недостаточно прав", status.HTTP_403_FORBIDDEN)

    now = datetime.now(UTC)
    production = context.production
    event_code: str
    created_event: StoryEvent | None = None
    if command == "voiceover-ready":
        if production.voiceover_ready:
            raise _error("VOICEOVER_ALREADY_READY", "Озвучка уже отмечена готовой")
        if _has_pending_correction(db, story_id=story_id, scope="voiceover", for_update=True):
            raise _error("INVALID_TRANSITION", "Сначала завершите открытые правки озвучки")
        production.voiceover_ready = True
        production.voiceover_ready_by_user_id = actor.id
        production.voiceover_ready_at = now
        event_code = "voiceover_ready"
    elif command == "voiceover-not-ready":
        if not production.voiceover_ready:
            raise _error("VOICEOVER_ALREADY_NOT_READY", "Озвучка уже находится в работе")
        package, created_event = create_correction_package_rows(
            db,
            story_id=story_id,
            revision_no=context.scenario.revision_no,
            production=production,
            actor=actor,
            source="internal",
            parts=[
                CorrectionPartInput(
                    scope="voiceover",
                    description=description or "",
                    assignee_user_id=assignee_user_id or 0,
                )
            ],
            now=now,
            event_code="voiceover_returned",
        )
        event_code = "voiceover_returned"
    elif command == "video-start":
        if revision != context.scenario.revision_no:
            raise _error("REVISION_NOT_CURRENT", "Редакция сценария уже изменилась")
        if production.video_started_at is not None:
            raise _error("VIDEO_ALREADY_STARTED", "Монтаж уже начат")
        if _has_pending_correction(db, story_id=story_id, scope="video", for_update=True):
            raise _error("OPEN_VIDEO_CORRECTION_EXISTS", "Сначала завершите открытые правки ролика")
        production.video_started_revision = revision
        production.video_started_by_user_id = actor.id
        production.video_started_at = now
        event_code = "video_started"
    elif command == "video-ready":
        if production.video_started_at is None:
            raise _error("VIDEO_NOT_STARTED", "Монтаж ещё не начат")
        if production.video_ready_at is not None:
            raise _error("VIDEO_ALREADY_READY", "Ролик уже отмечен готовым")
        if _has_pending_correction(db, story_id=story_id, scope="video", for_update=True):
            raise _error("OPEN_VIDEO_CORRECTION_EXISTS", "Сначала завершите открытые правки ролика")
        production.video_ready_by_user_id = actor.id
        production.video_ready_at = now
        event_code = "video_ready"
    elif command == "video-approve-for-titles":
        if production.video_approved_for_titles_at is not None:
            raise _error("INVALID_TRANSITION", "Ролик уже допущен к титрам")
        if _has_pending_correction(db, story_id=story_id, scope="video", for_update=True):
            raise _error("OPEN_VIDEO_CORRECTION_EXISTS", "Сначала завершите открытые правки ролика")
        if production.video_ready_at is None:
            raise _error("VIDEO_NOT_READY", "Ролик ещё не готов")
        if context.workflow.editorial_revision is None:
            raise _error("EDITORIAL_GATE_NOT_MET", "Редакционная готовность не подтверждена")
        if context.workflow.proofread_revision is None:
            raise _error("PROOFREAD_GATE_NOT_MET", "Корректура не завершена")
        production.video_approved_for_titles_by_user_id = actor.id
        production.video_approved_for_titles_at = now
        event_code = "video_approved_for_titles"
    elif command == "titles-start":
        titles_gate = (
            context.workflow.editorial_revision is not None
            and context.workflow.proofread_revision is not None
            and production.video_approved_for_titles_at is not None
        )
        if not titles_gate:
            raise _error("TITLES_INITIAL_GATE_NOT_MET", "Первоначальный допуск к титрам не выполнен")
        if _has_pending_correction(db, story_id=story_id, scope="titles", for_update=True):
            raise _error("OPEN_TITLES_CORRECTION_EXISTS", "Сначала завершите открытые правки титров")
        if revision != context.scenario.revision_no:
            raise _error("REVISION_NOT_CURRENT", "Редакция сценария уже изменилась")
        if production.titles_started_at is not None:
            raise _error("TITLES_ALREADY_STARTED", "Работа над титрами уже начата")
        production.titles_started_revision = revision
        production.titles_started_by_user_id = actor.id
        production.titles_started_at = now
        event_code = "titles_started"
    elif command == "titles-ready":
        if production.titles_started_at is None:
            raise _error("TITLES_NOT_STARTED", "Работа над титрами ещё не начата")
        if production.titles_ready_at is not None:
            raise _error("TITLES_ALREADY_READY", "Титры уже отмечены готовыми")
        if _has_pending_correction(db, story_id=story_id, scope="titles", for_update=True):
            raise _error("OPEN_TITLES_CORRECTION_EXISTS", "Сначала завершите открытые правки титров")
        production.titles_ready_by_user_id = actor.id
        production.titles_ready_at = now
        event_code = "titles_ready"
    elif command == "titles-accept":
        if production.titles_accepted_at is not None:
            raise _error("TITLES_ALREADY_ACCEPTED", "Титры уже приняты")
        if _has_pending_correction(db, story_id=story_id, scope="titles", for_update=True):
            raise _error("OPEN_TITLES_CORRECTION_EXISTS", "Сначала завершите открытые правки титров")
        if production.titles_ready_at is None:
            raise _error("TITLES_NOT_READY", "Титры ещё не готовы")
        production.titles_accepted_by_user_id = actor.id
        production.titles_accepted_at = now
        event_code = "titles_accepted"
    else:
        raise _error("INVALID_TRANSITION", "Команда производства не поддерживается")

    event = created_event or _record_event(
        db,
        context=context,
        actor=actor,
        event_code=event_code,
        now=now,
    )
    return _ack(
        db,
        event=event,
        changed_at=now,
        resource_type="story_production",
        resource_id=story_id,
    )
