import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from backend.config import get_settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)
settings = get_settings()


def _run_migrations(engine):
    """Add missing columns to existing tables (safe to run on every startup)."""
    migrations = [
        # link_sent added to orders
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS link_sent BOOLEAN NOT NULL DEFAULT FALSE",
        # admin_message_id added to orders
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS admin_message_id BIGINT",
        # telegram_first_name added to orders (customer name)
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS telegram_first_name VARCHAR(255)",
        # payment_type added to orders
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_type VARCHAR(50) NOT NULL DEFAULT 'slip'",
        # telegram_user_id must be nullable (Telegram login removed)
        "ALTER TABLE orders ALTER COLUMN telegram_user_id DROP NOT NULL",
        # telegram_username must be nullable
        "ALTER TABLE orders ALTER COLUMN telegram_username DROP NOT NULL",
        # invite_links stores JSON array of invite link URLs
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS invite_links TEXT",
        # announcements table columns (created via create_all, these guard extras)
        "ALTER TABLE announcements ADD COLUMN IF NOT EXISTS images TEXT",
        "ALTER TABLE announcements ADD COLUMN IF NOT EXISTS font_size VARCHAR(10) NOT NULL DEFAULT 'base'",
        "ALTER TABLE announcements ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE",
        # phone_number for order lookup without order ID
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS phone_number VARCHAR(20)",
        # image_urls stores JSON array of product image URLs
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS image_urls TEXT",
        # sort_order for manual product ordering
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0",
        # is_featured + badge fields for highlighting products on storefront
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS badge_text VARCHAR(50)",
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS badge_color VARCHAR(20)",
        # sales_count tracks total approved orders per product
        "ALTER TABLE products ADD COLUMN IF NOT EXISTS sales_count INTEGER NOT NULL DEFAULT 0",
        # finance_entries table columns (created via create_all, these guard extras)
        "ALTER TABLE finance_entries ADD COLUMN IF NOT EXISTS order_id INTEGER",
    ]
    from sqlalchemy import text
    with engine.connect() as conn:
        for sql in migrations:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception as e:
                logger.warning(f"Migration skipped (probably already applied): {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    from backend.database import engine, Base
    if engine is not None:
        Base.metadata.create_all(bind=engine)
        logger.info("Database tables created/verified")
        try:
            _run_migrations(engine)
            logger.info("Database migrations applied")
        except Exception as e:
            logger.error(f"Migration error: {e}")
    else:
        logger.warning("Skipping DB init — DATABASE_URL not set")

    if settings.bot_token and settings.webhook_url:
        try:
            from backend import bot as bot_module
            await bot_module.setup_webhook(settings.webhook_url)
        except Exception as e:
            logger.warning(f"Could not set webhook on startup: {e}")
    else:
        logger.warning("BOT_TOKEN or WEBHOOK_URL not set — skipping webhook setup")

    yield
    logger.info("Shutting down")


app = FastAPI(
    title="Digital Product Store API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from backend.routes.products import router as products_router
from backend.routes.orders import router as orders_router
from backend.routes.admin import router as admin_router
from backend.routes.auth import router as auth_router
from backend.routes.announcements import router as announcements_router
from backend.routes.finance import router as finance_router
from backend.webhook import router as webhook_router

app.include_router(products_router, prefix="/api")
app.include_router(orders_router, prefix="/api")
app.include_router(admin_router, prefix="/api")
app.include_router(auth_router, prefix="/api")
app.include_router(announcements_router, prefix="/api")
app.include_router(finance_router, prefix="/api")
app.include_router(webhook_router)

STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "artifacts", "store", "dist", "public")

if os.path.isdir(STATIC_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC_DIR, "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        index = os.path.join(STATIC_DIR, "index.html")
        return FileResponse(index)
else:
    @app.get("/", include_in_schema=False)
    async def root():
        return {"message": "Digital Product Store API is running. Add env vars and build the frontend."}


@app.get("/api/healthz")
async def healthz():
    return {
        "status": "ok",
        "bot_configured": bool(settings.bot_token),
        "database_configured": bool(settings.database_url),
    }
