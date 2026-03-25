from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import User
from app.db.session import get_db
from app.services.export_service import (
    ExportInputNotFoundError,
    build_story_exchange_payload,
    generate_docx_bytes,
    generate_pdf_bytes,
    generate_story_exchange_bytes,
    fetch_export_payload,
    persist_export_bytes,
)


router = APIRouter(prefix="/api/v1/projects", tags=["exports"])


@router.get("/{project_id}/export/docx")
def export_project_docx(
    project_id: int,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> Response:
    try:
        payload = fetch_export_payload(db, project_id)
    except ExportInputNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc

    try:
        content = generate_docx_bytes(payload)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=str(exc),
        ) from exc

    file_name = f"newscast_project_{project_id}.docx"
    persist_export_bytes(project_id=project_id, file_name=file_name, content=content)
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{file_name}"'},
    )


@router.get("/{project_id}/export/pdf")
def export_project_pdf(
    project_id: int,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> Response:
    try:
        payload = fetch_export_payload(db, project_id)
    except ExportInputNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc

    try:
        content = generate_pdf_bytes(payload)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=str(exc),
        ) from exc

    file_name = f"newscast_project_{project_id}.pdf"
    persist_export_bytes(project_id=project_id, file_name=file_name, content=content)
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{file_name}"'},
    )


@router.get("/{project_id}/export/story-exchange")
def export_project_story_exchange(
    project_id: int,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> Response:
    try:
        payload = build_story_exchange_payload(db, project_id)
    except ExportInputNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc

    content = generate_story_exchange_bytes(payload)
    file_name = f"newscast_project_{project_id}_story_exchange_v1.json"
    persist_export_bytes(project_id=project_id, file_name=file_name, content=content)
    return Response(
        content=content,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{file_name}"'},
    )
