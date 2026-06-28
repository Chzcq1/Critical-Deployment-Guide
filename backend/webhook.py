import json
import logging
from decimal import Decimal
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

                # สร้างลิงก์เชิญและเก็บไว้ในออเดอร์ → ลูกค้าเห็นได้จากหน้าตรวจสอบสถานะ
                group_ids = _get_group_ids(db, order.product_id)
                invite_links = await bot_module.generate_invite_links(order.id, group_ids)

                if invite_links:
                    order.invite_links = json.dumps(invite_links)
                    order.link_sent = True
                    db.commit()

                from backend.models import Product as ProductModel, FinanceEntry
                from backend.routes.admin import _get_setting
                prod = db.query(ProductModel).filter(ProductModel.id == order.product_id).first()
                if prod:
                    prod.sales_count = (prod.sales_count or 0) + 1
                    db.commit()

                    # สร้าง FinanceEntry — บันทึกยอดเต็มเข้าระบบ
                    price = Decimal(str(prod.price))
                    db.add(FinanceEntry(
                        amount=price,
                        description=f"ออเดอร์ #{order.id} — {prod.name}",
                        admin_name="ระบบ",
                        entry_type="order",
                        order_id=order.id,
                    ))
                    db.commit()

                suffix = f"\n\n✅ อนุมัติโดย {admin_name}"
                if invite_links:
                    suffix += f"\n🔗 ลิงก์เข้ากลุ่มพร้อมแล้ว — ลูกค้าตรวจสอบได้ที่หน้าสถานะออเดอร์"
                else:
                    suffix += "\n⚠️ สร้างลิงก์ไม่ได้ — ตรวจสอบว่าบอทเป็นแอดมินกลุ่มหรือไม่"

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
