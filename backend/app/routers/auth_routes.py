from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from datetime import datetime, timedelta

from app.deps import get_db
from app.models import User, Tenant, TenantPlan, UserRole
from app.config import get_settings
from app.auth import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    get_current_user,
)
settings = get_settings()
router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    tenant_name: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


def generate_slug(name: str) -> str:
    return (
        name.lower()
        .strip()
        .replace(" ", "-")
        .replace("_", "-")
    )


@router.post("/register", response_model=TokenResponse)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    # Check if email is already used anywhere
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    slug = generate_slug(payload.tenant_name)

    existing_tenant = db.query(Tenant).filter(Tenant.slug == slug).first()
    if existing_tenant:
        raise HTTPException(status_code=400, detail="Tenant name is already taken")

    trial_ends_at = datetime.utcnow() + timedelta(days=settings.TRIAL_DAYS)

    tenant = Tenant(
        name=payload.tenant_name,
        slug=slug,
        plan=TenantPlan.demo,
        trial_ends_at=trial_ends_at,
    )
    db.add(tenant)
    db.flush()  # so tenant.id is available

    user = User(
        email=payload.email,
        password_hash=hash_password(payload.password),
        tenant_id=tenant.id,
        role=UserRole.admin,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    access = create_access_token(user)
    refresh = create_refresh_token(user)

    return TokenResponse(access_token=access, refresh_token=refresh)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if not user.is_active:
        raise HTTPException(status_code=403, detail="User inactive")

    access = create_access_token(user)
    refresh = create_refresh_token(user)
    return TokenResponse(access_token=access, refresh_token=refresh)


class RefreshRequest(BaseModel):
    refresh_token: str


@router.post("/refresh", response_model=TokenResponse)
def refresh_token(payload: RefreshRequest, db: Session = Depends(get_db)):
    from jose import JWTError, jwt

    try:
        payload_data = jwt.decode(
            payload.refresh_token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
        if payload_data.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    user_id = payload_data.get("sub")
    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    access = create_access_token(user)
    new_refresh = create_refresh_token(user)

    return TokenResponse(access_token=access, refresh_token=new_refresh)


@router.get("/me")
def me(current_user: User = Depends(get_current_user)):
    return {
        "id": str(current_user.id),
        "email": current_user.email,
        "tenant_id": str(current_user.tenant_id),
        "role": current_user.role.value,
        "ai_enabled": bool(current_user.ai_enabled),
    }
