import logging
from fastapi import APIRouter, Request, HTTPException
from telegram import Update, Bot
from telegram.ext import Application
from backend.config import get_settings
from backend import bot as bot_module

router = APIRouter()
logger = logging.getLogger(__name__)
settings = get_settings()


@router.post("/webhook")
async def telegram_webhook(request: Request):
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    update = Update.de_json(data, bot_module.bot)

    if update.callback_query:
        query = update.callback_query
        await query.answer()

        data_str = query.data or ""
        if ":" not in data_str:
            return {"ok": True}

        action, order_id_str = data_str.split(":", 1)
        try:
            order_id = int(order_id_str)
        except ValueError:
            return {"ok": True}

        from backend.database import SessionLocal
        from backend.models import Order

        db = SessionLocal()
        try:
            order = db.query(Order).filter(Order.id == order_id).first()
            if not order or order.status != "pending":
                await query.edit_message_text(
                    text=f"{query.message.text}\n\n⚠️ Order already processed.",
                )
                return {"ok": True}

            admin_name = query.from_user.first_name or "Admin"

            if action == "approve":
                order.status = "approved"
                db.commit()

                group_ids = order.product_id and _get_group_ids(db, order.product_id) or ""
                await bot_module.approve_order(order.id, order.telegram_user_id, group_ids)
                await query.edit_message_text(
                    text=f"{query.message.text}\n\n✅ *Approved* by {admin_name}",
                    parse_mode="Markdown",
                )

            elif action == "reject":
                order.status = "rejected"
                db.commit()

                await bot_module.reject_order(order.id, order.telegram_user_id)
                await query.edit_message_text(
                    text=f"{query.message.text}\n\n❌ *Rejected* by {admin_name}",
                    parse_mode="Markdown",
                )
        except Exception as e:
            logger.error(f"Error processing callback: {e}")
        finally:
            db.close()

    return {"ok": True}


def _get_group_ids(db, product_id: int) -> str:
    from backend.models import Product
    product = db.query(Product).filter(Product.id == product_id).first()
    return (product.telegram_group_ids or "") if product else ""
