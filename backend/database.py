import logging
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from backend.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

Base = declarative_base()

if settings.database_url:
    engine = create_engine(
        settings.database_url,
        pool_pre_ping=True,
        pool_recycle=300,
    )
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
else:
    logger.warning("DATABASE_URL is not set — database features will be unavailable")
    engine = None
    SessionLocal = None


def get_db():
    if not SessionLocal:
        raise RuntimeError("DATABASE_URL is not configured. Set the DATABASE_URL environment variable.")
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
