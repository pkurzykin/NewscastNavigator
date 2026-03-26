from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.services.segment_ids import generate_segment_uid


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(String(32), default="author")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    authored_projects: Mapped[list["Project"]] = relationship(
        foreign_keys="Project.author_user_id",
        back_populates="author",
        cascade="all,save-update",
    )
    executed_projects: Mapped[list["Project"]] = relationship(
        foreign_keys="Project.executor_user_id",
        back_populates="executor",
        cascade="all,save-update",
    )
    proofread_projects: Mapped[list["Project"]] = relationship(
        foreign_keys="Project.proofreader_user_id",
        back_populates="proofreader",
        cascade="all,save-update",
    )
    archived_projects: Mapped[list["Project"]] = relationship(
        foreign_keys="Project.archived_by",
        back_populates="archived_by_user",
        cascade="all,save-update",
    )
    status_changed_projects: Mapped[list["Project"]] = relationship(
        foreign_keys="Project.status_changed_by",
        back_populates="status_changed_by_user",
        cascade="all,save-update",
    )
    project_events: Mapped[list["ProjectEvent"]] = relationship(
        back_populates="actor",
        cascade="all,save-update",
    )
    created_revisions: Mapped[list["ProjectRevision"]] = relationship(
        foreign_keys="ProjectRevision.created_by",
        back_populates="created_by_user",
        cascade="all,save-update",
    )


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(32), default="draft", index=True)
    rubric: Mapped[str | None] = mapped_column(String(120), nullable=True)
    planned_duration: Mapped[str | None] = mapped_column(String(32), nullable=True)
    source_project_id: Mapped[int | None] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    project_file_root: Mapped[str | None] = mapped_column(String(512), nullable=True)
    project_file_roots_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    project_note: Mapped[str] = mapped_column(Text, default="")
    author_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    executor_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    executor_user_ids_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    proofreader_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    archived_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    status_changed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    status_changed_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )

    author: Mapped[User | None] = relationship(
        foreign_keys=[author_user_id],
        back_populates="authored_projects",
    )
    executor: Mapped[User | None] = relationship(
        foreign_keys=[executor_user_id],
        back_populates="executed_projects",
    )
    proofreader: Mapped[User | None] = relationship(
        foreign_keys=[proofreader_user_id],
        back_populates="proofread_projects",
    )
    source_project: Mapped["Project | None"] = relationship(
        remote_side=[id],
        foreign_keys=[source_project_id],
    )
    archived_by_user: Mapped[User | None] = relationship(
        foreign_keys=[archived_by],
        back_populates="archived_projects",
    )
    status_changed_by_user: Mapped[User | None] = relationship(
        foreign_keys=[status_changed_by],
        back_populates="status_changed_projects",
    )
    elements: Mapped[list["ScriptElement"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    comments: Mapped[list["ProjectComment"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    files: Mapped[list["ProjectFile"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    events: Mapped[list["ProjectEvent"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="ProjectEvent.created_at.desc()",
    )
    revisions: Mapped[list["ProjectRevision"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="ProjectRevision.revision_no.desc()",
    )


class ScriptElement(Base):
    __tablename__ = "script_elements"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        index=True,
    )
    segment_uid: Mapped[str] = mapped_column(
        String(40),
        default=generate_segment_uid,
        index=True,
        unique=True,
    )
    order_index: Mapped[int] = mapped_column(Integer, default=1, index=True)
    block_type: Mapped[str] = mapped_column(String(32), default="zk")
    text: Mapped[str] = mapped_column(Text, default="")
    content_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    speaker_text: Mapped[str] = mapped_column(Text, default="")
    file_name: Mapped[str] = mapped_column(Text, default="")
    tc_in: Mapped[str] = mapped_column(String(16), default="")
    tc_out: Mapped[str] = mapped_column(String(16), default="")
    additional_comment: Mapped[str] = mapped_column(Text, default="")
    formatting_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    rich_text_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    project: Mapped[Project] = relationship(back_populates="elements")


class ProjectComment(Base):
    __tablename__ = "project_comments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        index=True,
    )
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    text: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )

    project: Mapped[Project] = relationship(back_populates="comments")
    user: Mapped[User | None] = relationship()


class ProjectRevision(Base):
    __tablename__ = "project_revisions"
    __table_args__ = (
        UniqueConstraint("project_id", "revision_no", name="uq_project_revisions_project_revision_no"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        index=True,
    )
    revision_no: Mapped[int] = mapped_column(Integer, index=True)
    parent_revision_id: Mapped[str | None] = mapped_column(
        ForeignKey("project_revisions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    branch_key: Mapped[str] = mapped_column(String(64), default="main")
    revision_kind: Mapped[str] = mapped_column(String(32), default="manual")
    status: Mapped[str] = mapped_column(String(32), default="draft", index=True)
    title: Mapped[str] = mapped_column(String(255), default="")
    comment: Mapped[str] = mapped_column(Text, default="")
    project_title: Mapped[str] = mapped_column(String(255))
    project_rubric: Mapped[str | None] = mapped_column(String(120), nullable=True)
    project_planned_duration: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    is_current: Mapped[bool] = mapped_column(Boolean, default=False, index=True)

    project: Mapped[Project] = relationship(back_populates="revisions")
    created_by_user: Mapped[User | None] = relationship(
        foreign_keys=[created_by],
        back_populates="created_revisions",
    )
    parent_revision: Mapped["ProjectRevision | None"] = relationship(
        remote_side=[id],
        foreign_keys=[parent_revision_id],
    )
    elements: Mapped[list["ProjectRevisionElement"]] = relationship(
        back_populates="revision",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="ProjectRevisionElement.order_index.asc(), ProjectRevisionElement.id.asc()",
    )


class ProjectRevisionElement(Base):
    __tablename__ = "project_revision_elements"
    __table_args__ = (
        UniqueConstraint("revision_id", "segment_uid", name="uq_project_revision_elements_revision_segment"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    revision_id: Mapped[str] = mapped_column(
        ForeignKey("project_revisions.id", ondelete="CASCADE"),
        index=True,
    )
    segment_uid: Mapped[str] = mapped_column(String(40), index=True)
    order_index: Mapped[int] = mapped_column(Integer, default=1, index=True)
    block_type: Mapped[str] = mapped_column(String(32), default="zk")
    text: Mapped[str] = mapped_column(Text, default="")
    content_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    speaker_text: Mapped[str] = mapped_column(Text, default="")
    file_name: Mapped[str] = mapped_column(Text, default="")
    tc_in: Mapped[str] = mapped_column(String(16), default="")
    tc_out: Mapped[str] = mapped_column(String(16), default="")
    additional_comment: Mapped[str] = mapped_column(Text, default="")
    formatting_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    rich_text_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    revision: Mapped[ProjectRevision] = relationship(back_populates="elements")


class ProjectFile(Base):
    __tablename__ = "project_files"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        index=True,
    )
    original_name: Mapped[str] = mapped_column(Text)
    storage_path: Mapped[str] = mapped_column(Text)
    mime_type: Mapped[str] = mapped_column(String(255), default="")
    file_size: Mapped[int] = mapped_column(BigInteger, default=0)
    uploaded_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )

    project: Mapped[Project] = relationship(back_populates="files")
    uploader: Mapped[User | None] = relationship()


class ProjectEvent(Base):
    __tablename__ = "project_events"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        index=True,
    )
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    old_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    meta_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    project: Mapped[Project] = relationship(back_populates="events")
    actor: Mapped[User | None] = relationship(back_populates="project_events")
