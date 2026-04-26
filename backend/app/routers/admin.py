from datetime import datetime
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import admin_required
from app.deps import get_db
from app.models import LLMUsageEvent, User


router = APIRouter(prefix="/api/admin", tags=["admin"])


class UsageByModel(BaseModel):
    model: str
    operation: str
    calls: int
    total_tokens: int
    estimated_cost: float


class UsageByUser(BaseModel):
    user_id: Optional[str] = None
    email: str
    calls: int
    total_tokens: int
    prompt_tokens: int
    completion_tokens: int
    estimated_cost: float


class LLMUsageSummaryOut(BaseModel):
    total_calls: int
    total_tokens: int
    prompt_tokens: int
    completion_tokens: int
    estimated_cost: float
    by_model: list[UsageByModel]
    by_user: list[UsageByUser]


class LLMUsageEventOut(BaseModel):
    id: str
    operation: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    estimated_cost: float
    status: str
    error_message: Optional[str] = None
    file_id: Optional[str] = None
    user_id: Optional[str] = None
    user_email: Optional[str] = None
    created_at: datetime


def _as_float(value) -> float:
    if isinstance(value, Decimal):
        return float(value)
    return float(value or 0)


def _base_query(
    db: Session,
    user: User,
    date_from: Optional[datetime],
    date_to: Optional[datetime],
):
    query = db.query(LLMUsageEvent).filter(LLMUsageEvent.tenant_id == user.tenant_id)
    if date_from:
        query = query.filter(LLMUsageEvent.created_at >= date_from)
    if date_to:
        query = query.filter(LLMUsageEvent.created_at <= date_to)
    return query


@router.get("/llm-usage/summary", response_model=LLMUsageSummaryOut)
def llm_usage_summary(
    date_from: Optional[datetime] = Query(default=None, alias="from"),
    date_to: Optional[datetime] = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    user: User = Depends(admin_required),
):
    query = _base_query(db, user, date_from, date_to)
    totals = query.with_entities(
        func.count(LLMUsageEvent.id),
        func.coalesce(func.sum(LLMUsageEvent.total_tokens), 0),
        func.coalesce(func.sum(LLMUsageEvent.prompt_tokens), 0),
        func.coalesce(func.sum(LLMUsageEvent.completion_tokens), 0),
        func.coalesce(func.sum(LLMUsageEvent.estimated_cost), 0),
    ).one()

    grouped = (
        query.with_entities(
            LLMUsageEvent.model,
            LLMUsageEvent.operation,
            func.count(LLMUsageEvent.id),
            func.coalesce(func.sum(LLMUsageEvent.total_tokens), 0),
            func.coalesce(func.sum(LLMUsageEvent.estimated_cost), 0),
        )
        .group_by(LLMUsageEvent.model, LLMUsageEvent.operation)
        .order_by(func.coalesce(func.sum(LLMUsageEvent.estimated_cost), 0).desc())
        .all()
    )

    grouped_by_user = (
        query.outerjoin(User, LLMUsageEvent.user_id == User.id)
        .with_entities(
            LLMUsageEvent.user_id,
            func.coalesce(User.email, "Unknown user"),
            func.count(LLMUsageEvent.id),
            func.coalesce(func.sum(LLMUsageEvent.total_tokens), 0),
            func.coalesce(func.sum(LLMUsageEvent.prompt_tokens), 0),
            func.coalesce(func.sum(LLMUsageEvent.completion_tokens), 0),
            func.coalesce(func.sum(LLMUsageEvent.estimated_cost), 0),
        )
        .group_by(LLMUsageEvent.user_id, User.email)
        .order_by(func.coalesce(func.sum(LLMUsageEvent.total_tokens), 0).desc())
        .all()
    )

    return LLMUsageSummaryOut(
        total_calls=int(totals[0] or 0),
        total_tokens=int(totals[1] or 0),
        prompt_tokens=int(totals[2] or 0),
        completion_tokens=int(totals[3] or 0),
        estimated_cost=_as_float(totals[4]),
        by_model=[
            UsageByModel(
                model=row[0],
                operation=row[1],
                calls=int(row[2] or 0),
                total_tokens=int(row[3] or 0),
                estimated_cost=_as_float(row[4]),
            )
            for row in grouped
        ],
        by_user=[
            UsageByUser(
                user_id=str(row[0]) if row[0] else None,
                email=row[1],
                calls=int(row[2] or 0),
                total_tokens=int(row[3] or 0),
                prompt_tokens=int(row[4] or 0),
                completion_tokens=int(row[5] or 0),
                estimated_cost=_as_float(row[6]),
            )
            for row in grouped_by_user
        ],
    )


@router.get("/llm-usage/events", response_model=list[LLMUsageEventOut])
def llm_usage_events(
    date_from: Optional[datetime] = Query(default=None, alias="from"),
    date_to: Optional[datetime] = Query(default=None, alias="to"),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    user: User = Depends(admin_required),
):
    events = (
        _base_query(db, user, date_from, date_to)
        .outerjoin(User, LLMUsageEvent.user_id == User.id)
        .add_columns(User.email)
        .order_by(LLMUsageEvent.created_at.desc())
        .limit(limit)
        .all()
    )
    rows = []
    for event, email in events:
        rows.append(
            LLMUsageEventOut(
                id=str(event.id),
                operation=event.operation,
                model=event.model,
                prompt_tokens=event.prompt_tokens,
                completion_tokens=event.completion_tokens,
                total_tokens=event.total_tokens,
                estimated_cost=_as_float(event.estimated_cost),
                status=event.status,
                error_message=event.error_message,
                file_id=str(event.file_id) if event.file_id else None,
                user_id=str(event.user_id) if event.user_id else None,
                user_email=email,
                created_at=event.created_at,
            )
        )
    return rows
