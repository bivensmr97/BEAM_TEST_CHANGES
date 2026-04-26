from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import admin_required, get_current_user
from app.deps import get_db
from app.models import Tenant, User


router = APIRouter(prefix="/api/ai-settings", tags=["ai-settings"])


class AISettingsOut(BaseModel):
    tenant_ai_enabled: bool
    user_ai_enabled: bool
    effective_ai_enabled: bool


class UserAISettingsIn(BaseModel):
    ai_enabled: bool


class TenantAISettingsIn(BaseModel):
    ai_enabled: bool


def _tenant_for_user(db: Session, user: User) -> Tenant:
    return db.query(Tenant).filter(Tenant.id == user.tenant_id).first()


def _settings_out(db: Session, user: User) -> AISettingsOut:
    tenant = _tenant_for_user(db, user)
    tenant_enabled = bool(tenant.ai_enabled) if tenant else False
    user_enabled = bool(user.ai_enabled)
    return AISettingsOut(
        tenant_ai_enabled=tenant_enabled,
        user_ai_enabled=user_enabled,
        effective_ai_enabled=tenant_enabled and user_enabled,
    )


@router.get("", response_model=AISettingsOut)
@router.get("/", response_model=AISettingsOut)
def get_ai_settings(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return _settings_out(db, user)


@router.put("/me", response_model=AISettingsOut)
def update_my_ai_settings(
    payload: UserAISettingsIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    user.ai_enabled = payload.ai_enabled
    db.commit()
    db.refresh(user)
    return _settings_out(db, user)


@router.put("/tenant", response_model=AISettingsOut)
def update_tenant_ai_settings(
    payload: TenantAISettingsIn,
    db: Session = Depends(get_db),
    user: User = Depends(admin_required),
):
    tenant = _tenant_for_user(db, user)
    tenant.ai_enabled = payload.ai_enabled
    db.commit()
    db.refresh(tenant)
    db.refresh(user)
    return _settings_out(db, user)
