# backend/app/db.py
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from .config import get_settings

settings = get_settings()


class Base(DeclarativeBase):
    pass


engine = create_engine(
    settings.sqlalchemy_database_uri,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db():
    # For now, create tables automatically. Later we'll do proper migrations.
    from . import models  # noqa
    Base.metadata.create_all(bind=engine)
    _ensure_ai_toggle_columns()


def _ensure_ai_toggle_columns():
    statements = [
        """
        IF COL_LENGTH('tenants', 'ai_enabled') IS NULL
        BEGIN
            ALTER TABLE tenants ADD ai_enabled BIT NOT NULL CONSTRAINT DF_tenants_ai_enabled DEFAULT 1
        END
        """,
        """
        IF COL_LENGTH('users', 'ai_enabled') IS NULL
        BEGIN
            ALTER TABLE users ADD ai_enabled BIT NOT NULL CONSTRAINT DF_users_ai_enabled DEFAULT 1
        END
        """,
    ]
    try:
        with engine.begin() as conn:
            for statement in statements:
                conn.execute(text(statement))
    except Exception:
        # Non-MSSQL local/dev databases can rely on create_all for fresh schemas.
        pass
    
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
