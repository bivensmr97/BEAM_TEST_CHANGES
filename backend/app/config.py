from pydantic_settings import BaseSettings
from functools import lru_cache
from typing import Optional
import urllib.parse
import os


class Settings(BaseSettings):
    # --- Azure ---
    AZURE_SQL_CONNSTRING: str
    AZURE_BLOB_CONNSTRING: str
    BLOB_CONTAINER: str = "tenant-files"
    #OPENAI_KEY: str should be handled within ACA env now.

    # --- LLM usage/cost tracking ---
    OPENAI_MODEL: str = "gpt-4o-mini"
    LLM_DEFAULT_INPUT_PRICE_PER_1M: Optional[float] = None
    LLM_DEFAULT_OUTPUT_PRICE_PER_1M: Optional[float] = None


    # --- JWT ---
    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY")
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 14

    # --- Trial settings ---
    TRIAL_DAYS: int = 14

    class Config:
        env_file = ".env"
        case_sensitive = False

    @property
    def sqlalchemy_database_uri(self) -> str:
        parts = {}
        for segment in self.AZURE_SQL_CONNSTRING.split(";"):
            if not segment.strip():
                continue
            key, _, value = segment.partition("=")
            parts[key.strip().lower()] = value.strip()

        server = parts.get("server") or parts.get("data source")
        if server and server.lower().startswith("tcp:"):
            server = server[4:]
        database = parts.get("database")
        user = parts.get("user id") or parts.get("uid")
        password = parts.get("password") or parts.get("pwd")

        if not (server and database and user and password):
            raise ValueError("AZURE_SQL_CONNSTRING missing required parts")

        user_enc = urllib.parse.quote_plus(user)
        pwd_enc = urllib.parse.quote_plus(password)
        driver = urllib.parse.quote_plus("ODBC Driver 18 for SQL Server")

        return (
            f"mssql+pyodbc://{user_enc}:{pwd_enc}@{server}/{database}"
            f"?driver={driver}&Encrypt=yes&TrustServerCertificate=no"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
