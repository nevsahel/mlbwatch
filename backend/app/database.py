"""Create the shared SQLAlchemy engine, model base, and session factory."""

from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings


class Base(DeclarativeBase):
    """Base class whose subclasses are registered as database tables."""

    pass


# SQLite needs this option because API requests may use separate worker threads.
connect_args = {"check_same_thread": False} if settings.sqlalchemy_url.startswith("sqlite") else {}
engine = create_engine(settings.sqlalchemy_url, connect_args=connect_args, pool_pre_ping=True)
# Keep sessions reusable and avoid expiring objects immediately after commits.
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    """Yield a database session and always close it after the caller is done."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
