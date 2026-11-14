"""Read environment-based settings used by the API and database."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy.engine import URL

PROJECT_ROOT = Path(__file__).resolve().parents[2]
# Load the project's optional .env file before reading configuration values.
load_dotenv(PROJECT_ROOT / ".env")


@dataclass(frozen=True)
class Settings:
    """Application settings with development-friendly defaults."""

    environment: str = os.getenv("NODE_ENV", os.getenv("APP_ENV", "development"))
    port: int = int(os.getenv("PORT", "3000"))
    database_url: str = os.getenv("DATABASE_URL", "")
    database_dialect: str = os.getenv("DB_DIALECT", "sqlite")
    database_storage: str = os.getenv("DB_STORAGE", "./backend/database.sqlite")

    @property
    def is_development(self) -> bool:
        """Control whether detailed error information is returned to clients."""
        return self.environment != "production"

    @property
    def sqlalchemy_url(self) -> str:
        """Build a SQLAlchemy connection URL from the database settings."""
        if self.database_url:
            return self.database_url
        if self.database_dialect != "sqlite":
            raise ValueError("Set DATABASE_URL when DB_DIALECT is not sqlite.")
        storage = Path(self.database_storage)
        # Resolve relative SQLite paths from the repository root, not the shell's folder.
        if not storage.is_absolute() and str(storage) != ":memory:":
            storage = PROJECT_ROOT / storage
        if str(storage) == ":memory:":
            return "sqlite+pysqlite:///:memory:"
        return URL.create("sqlite+pysqlite", database=str(storage)).render_as_string(hide_password=False)


settings = Settings()
