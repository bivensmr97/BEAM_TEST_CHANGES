import json
from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.deps import get_db
from app.models import File, SavedReport, User


router = APIRouter(prefix="/api/files", tags=["reports"])


class SavedReportIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=1000)
    chart_configs: list[dict[str, Any]] = Field(default_factory=list)
    filters: dict[str, Any] = Field(default_factory=dict)
    sheet_name: Optional[str] = Field(default=None, max_length=255)


class SavedReportPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=1000)
    chart_configs: Optional[list[dict[str, Any]]] = None
    filters: Optional[dict[str, Any]] = None
    sheet_name: Optional[str] = Field(default=None, max_length=255)


class SavedReportOut(BaseModel):
    id: UUID
    file_id: UUID
    name: str
    description: Optional[str] = None
    chart_configs: list[dict[str, Any]]
    filters: dict[str, Any]
    sheet_name: Optional[str] = None
    created_by: UUID
    created_at: datetime
    updated_at: datetime


def _get_file_for_user(file_id: str, db: Session, user: User) -> File:
    file = (
        db.query(File)
        .filter(File.id == file_id, File.tenant_id == user.tenant_id)
        .first()
    )
    if not file:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    return file


def _get_report_for_user(file_id: str, report_id: str, db: Session, user: User) -> SavedReport:
    report = (
        db.query(SavedReport)
        .filter(
            SavedReport.id == report_id,
            SavedReport.file_id == file_id,
            SavedReport.tenant_id == user.tenant_id,
        )
        .first()
    )
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saved report not found")
    return report


def _decode_json(raw: str | None, fallback: Any) -> Any:
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except Exception:
        return fallback


def _to_out(report: SavedReport) -> SavedReportOut:
    return SavedReportOut(
        id=report.id,
        file_id=report.file_id,
        name=report.name,
        description=report.description,
        chart_configs=_decode_json(report.chart_configs_json, []),
        filters=_decode_json(report.filters_json, {}),
        sheet_name=report.sheet_name,
        created_by=report.created_by,
        created_at=report.created_at,
        updated_at=report.updated_at,
    )


@router.get("/{file_id}/reports", response_model=list[SavedReportOut])
def list_reports(
    file_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _get_file_for_user(file_id, db, user)
    reports = (
        db.query(SavedReport)
        .filter(SavedReport.file_id == file_id, SavedReport.tenant_id == user.tenant_id)
        .order_by(SavedReport.updated_at.desc())
        .all()
    )
    return [_to_out(report) for report in reports]


@router.post("/{file_id}/reports", response_model=SavedReportOut, status_code=status.HTTP_201_CREATED)
def create_report(
    file_id: str,
    payload: SavedReportIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _get_file_for_user(file_id, db, user)
    report = SavedReport(
        tenant_id=user.tenant_id,
        file_id=file_id,
        created_by=user.id,
        name=payload.name.strip(),
        description=payload.description,
        chart_configs_json=json.dumps(payload.chart_configs),
        filters_json=json.dumps(payload.filters or {}),
        sheet_name=payload.sheet_name,
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return _to_out(report)


@router.get("/{file_id}/reports/{report_id}", response_model=SavedReportOut)
def get_report(
    file_id: str,
    report_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _get_file_for_user(file_id, db, user)
    return _to_out(_get_report_for_user(file_id, report_id, db, user))


@router.put("/{file_id}/reports/{report_id}", response_model=SavedReportOut)
def update_report(
    file_id: str,
    report_id: str,
    payload: SavedReportPatch,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _get_file_for_user(file_id, db, user)
    report = _get_report_for_user(file_id, report_id, db, user)

    if payload.name is not None:
        report.name = payload.name.strip()
    if payload.description is not None:
        report.description = payload.description
    if payload.chart_configs is not None:
        report.chart_configs_json = json.dumps(payload.chart_configs)
    if payload.filters is not None:
        report.filters_json = json.dumps(payload.filters)
    if "sheet_name" in payload.model_fields_set:
        report.sheet_name = payload.sheet_name

    db.commit()
    db.refresh(report)
    return _to_out(report)


@router.delete("/{file_id}/reports/{report_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_report(
    file_id: str,
    report_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _get_file_for_user(file_id, db, user)
    report = _get_report_for_user(file_id, report_id, db, user)
    db.delete(report)
    db.commit()
