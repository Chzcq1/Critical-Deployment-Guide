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

    # ── /start order_42  (ลูกค้ากด deep link) ──────────────────────────
    if update.message and update.message.text:
        text = update.message.text.strip()
        if text.startswith("/start order_"):
            payload = text[len("/start order_"):]
            try:
                order_id = int(payload)
            except ValueError:
                return {"ok": True}
            await _handle_order_claim(update, order_id)
            return {"ok": True}

        if text == "/start":
            try:
                await update.message.reply_text(
                    "👋 สวัสดีครับ! นี่คือบอทรับสินค้าดิจิทัล\n\n"
                    "หลังจากแอดมินอนุมัติออเดอร์ของคุณ ลิงก์เข้ากลุ่มจะถูกส่งมาที่นี่โดยอัตโนมัติ 🎉"
                )
            except Exception:
                pass
            return {"ok": True}

    # ── Inline keyboard callbacks (approve / reject) ────────────────────
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
                    suffix = "\n\n⚠️ ดำเนินการไปแล้ว"
                    if query.message.photo:
                        await query.edit_message_caption(caption=(query.message.caption or "") + suffix)
                    else:
                        await query.edit_message_text(text=(query.message.text or "") + suffix)
                except Exception:
                    pass
                return {"ok": True}

            admin_name = query.from_user.first_name if query.from_user else "Admin"

            if action == "approve":
                order.status = "approved"
                db.commit()

                group_ids = _get_group_ids(db, order.product_id)
                link_ok = await bot_module.approve_order(order.id, order.telegram_user_id or 0, group_ids)

                if link_ok:
                    order.link_sent = True
                    db.commit()

                suffix = f"\n\n✅ อนุมัติโดย {admin_name}"
                if not link_ok:
                    suffix += "\n⚠️ ยังส่งลิงก์ไม่ได้ — ลูกค้ายังไม่ได้กด deep link ใน Telegram"
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


async def _handle_order_claim(update: Update, order_id: int):
    """ลูกค้ากด deep link t.me/bot?start=order_42 → บันทึก Telegram ID ลงออเดอร์"""
    from backend.database import SessionLocal
    from backend.models import Order

    user = update.message.from_user
    if not user:
        return

    db = SessionLocal()
    try:
        order = db.query(Order).filter(Order.id == order_id).first()
        if not order:
            await update.message.reply_text(
                f"⚠️ ไม่พบออเดอร์ #{order_id} กรุณาตรวจสอบหมายเลขออเดอร์อีกครั้ง"
            )
            return

        # บันทึก Telegram ID ถ้ายังไม่มี
        if not order.telegram_user_id:
            order.telegram_user_id = user.id
            order.telegram_username = user.username
            if not order.telegram_first_name:
                order.telegram_first_name = user.first_name
            db.commit()
            logger.info(f"Claimed order #{order_id} by Telegram user {user.id}")

        if order.status == "pending":
            await update.message.reply_text(
                f"✅ ลงทะเบียนรับสินค้าสำเร็จ!\n\n"
                f"📦 ออเดอร์ #{order_id}: {order.product_name}\n"
                f"⏳ รอแอดมินตรวจสอบ — ลิงก์เข้ากลุ่มจะถูกส่งมาที่นี่ทันทีหลังอนุมัติ 🎉\n\n"
                f"ไม่ต้องทำอะไรเพิ่ม แค่รอแอดมินตรวจสอบนะครับ"
            )
        elif order.status == "approved":
            if order.link_sent:
                await update.message.reply_text(
                    f"✅ ออเดอร์ #{order_id} อนุมัติแล้ว และลิงก์เข้ากลุ่มถูกส่งไปแล้ว\n"
                    f"กรุณาตรวจสอบข้อความก่อนหน้าในแชทนี้"
                )
            else:
                # ยังไม่ได้ส่ง — ส่งลิงก์ให้เลย
                group_ids = _get_group_ids(db, order.product_id)
                from backend import bot as bot_module
                link_ok = await bot_module.approve_order(order.id, user.id, group_ids)
                if link_ok:
                    order.link_sent = True
                    db.commit()
        elif order.status == "rejected":
            await update.message.reply_text(
                f"❌ ออเดอร์ #{order_id} ไม่ได้รับการอนุมัติ\n"
                f"กรุณาติดต่อแอดมินหากมีข้อสงสัย"
            )
    except Exception as e:
        logger.error(f"Error in _handle_order_claim: {e}")
    finally:
        db.close()


def _get_group_ids(db, product_id: int) -> str:
    from backend.models import Product
    product = db.query(Product).filter(Product.id == product_id).first()
    return (product.telegram_group_ids or "") if product else ""
