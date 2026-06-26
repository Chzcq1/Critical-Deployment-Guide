import logging
from fastapi import APIRouter, Request, HTTPException
from telegram import Update
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

    try:
        tg_bot = bot_module.get_bot()
    except RuntimeError:
        return {"ok": True}

    update = Update.de_json(data, tg_bot)

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
                try:
                    if query.message.photo:
                        await query.edit_message_caption(caption=(query.message.caption or "") + "\n\n⚠️ ดำเนินการไปแล้ว")
                    else:
                        await query.edit_message_text(text=(query.message.text or "") + "\n\n⚠️ ดำเนินการไปแล้ว")
                except Exception:
                    pass
                return {"ok": True}

            admin_name = query.from_user.first_name if query.from_user else "Admin"

            if action == "approve":
                order.status = "approved"
                db.commit()

                group_ids = _get_group_ids(db, order.product_id) if order.product_id else ""
                link_ok = await bot_module.approve_order(order.id, order.telegram_user_id or 0, group_ids)

                if link_ok:
                    order.link_sent = True
                    db.commit()

                suffix = f"\n\n✅ อนุมัติโดย {admin_name}"
                if not link_ok:
                    suffix += "\n⚠️ ส่งลิงก์ไม่ได้ (ลูกค้าไม่ได้ start บอท หรือไม่มี Telegram ID)"
                try:
                    if query.message.photo:
                        await query.edit_message_caption(caption=(query.message.caption or "") + suffix)
                    else:
                        await query.edit_message_text(text=(query.message.text or "") + suffix)
                except Exception:
                    pass

            elif action == "reject":
                order.status = "rejected"
                db.commit()

                await bot_module.reject_order(order.id, order.telegram_user_id or 0)

                suffix = f"\n\n❌ ปฏิเสธโดย {admin_name}"
                try:
                    if query.message.photo:
                        await query.edit_message_caption(caption=(query.message.caption or "") + suffix)
                    else:
                        await query.edit_message_text(text=(query.message.text or "") + suffix)
                except Exception:
                    pass

        except Exception as e:
            logger.error(f"Error processing callback: {e}")
        finally:
            db.close()

    return {"ok": True}


def _get_group_ids(db, product_id: int) -> str:
    from backend.models import Product
    product = db.query(Product).filter(Product.id == product_id).first()
    return (product.telegram_group_ids or "") if product else ""
