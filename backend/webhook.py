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


async def _handle_wallet_otp_start(session_token: str, chat_id: int):
    """Handle /start otp_TOKEN — generate and send OTP via DM."""
    import secrets as _secrets
    from datetime import datetime, timezone
    from backend.database import SessionLocal
    from backend.models import WalletOTPSession

    db = SessionLocal()
    try:
        session = db.query(WalletOTPSession).filter(
            WalletOTPSession.session_token == session_token,
            WalletOTPSession.is_used == False,
        ).first()

        if not session:
            await bot_module.get_bot().send_message(
                chat_id=chat_id,
                text="❌ ลิงก์นี้หมดอายุหรือไม่ถูกต้อง\n\nกรุณากลับไปที่หน้าเว็บร้านค้าและขอ OTP ใหม่อีกครั้งครับ"
            )
            return

        expires = session.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) > expires:
            await bot_module.get_bot().send_message(
                chat_id=chat_id,
                text="⏰ ลิงก์นี้หมดอายุแล้ว\n\nกรุณากลับไปที่หน้าเว็บร้านค้าและขอ OTP ใหม่ครับ"
            )
            return

        otp = str(_secrets.randbelow(900000) + 100000)
        session.otp_code = otp
        session.telegram_chat_id = chat_id
        db.commit()

        await bot_module.send_wallet_otp(chat_id, otp, session.telegram_username)

    except Exception as e:
        logger.error(f"Error in _handle_wallet_otp_start: {e}")
        try:
            await bot_module.get_otp_bot().send_message(
                chat_id=chat_id,
                text="❌ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้งครับ"
            )
        except Exception:
            pass
    finally:
        db.close()


@router.post("/webhook-otp")
async def telegram_otp_webhook(request: Request):
    """Dedicated webhook endpoint for the OTP-only bot."""
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    try:
        otp_bot = bot_module.get_otp_bot()
    except RuntimeError:
        return {"ok": True}

    update = Update.de_json(data, otp_bot)

    if update.message and update.message.text:
        text = update.message.text.strip()
        chat_id = update.message.chat.id

        if text.startswith("/start"):
            payload = text[len("/start"):].strip()
            if payload.startswith("otp_"):
                # Deep link flow (normal path)
                token = payload[len("otp_"):]
                await _handle_wallet_otp_start(token, chat_id)
            else:
                # Deep link failed (iOS issue) — ask user to type username instead
                try:
                    await otp_bot.send_message(
                        chat_id=chat_id,
                        text=(
                            "🔐 <b>ยืนยันตัวตนกระเป๋าเครดิต</b>\n\n"
                            "กรุณาพิมพ์ Telegram Username ของคุณเพื่อรับ OTP:\n\n"
                            "<code>/otp ชื่อuser</code>\n\n"
                            "ตัวอย่าง: <code>/otp myusername</code>\n\n"
                            "💡 ไม่ต้องมี @ นำหน้า"
                        ),
                        parse_mode="HTML"
                    )
                except Exception:
                    pass

        elif text.startswith("/otp"):
            # Manual OTP fallback — user types /otp username
            raw = text[len("/otp"):].strip().lstrip("@").lower()
            if not raw:
                try:
                    await otp_bot.send_message(
                        chat_id=chat_id,
                        text="❌ กรุณาระบุ Username\n\nตัวอย่าง: <code>/otp myusername</code>",
                        parse_mode="HTML"
                    )
                except Exception:
                    pass
            else:
                await _handle_wallet_otp_by_username(raw, chat_id, otp_bot)

    return {"ok": True}


async def _handle_wallet_otp_by_username(username: str, chat_id: int, otp_bot):
    """Fallback: user types /otp username → find pending session → send OTP."""
    import secrets as _secrets
    from datetime import datetime, timezone
    from backend.database import SessionLocal
    from backend.models import WalletOTPSession

    db = SessionLocal()
    try:
        # Find the most recent unused, unexpired session for this username
        session = (
            db.query(WalletOTPSession)
            .filter(
                WalletOTPSession.telegram_username == username,
                WalletOTPSession.is_used == False,
            )
            .order_by(WalletOTPSession.created_at.desc())
            .first()
        )

        if not session:
            await otp_bot.send_message(
                chat_id=chat_id,
                text=(
                    "❌ ไม่พบคำขอ OTP สำหรับ <b>@{}</b>\n\n"
                    "กรุณากลับไปที่หน้าเว็บและกด <b>ต่อไป</b> ก่อนครับ"
                ).format(username),
                parse_mode="HTML"
            )
            return

        expires = session.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) > expires:
            await otp_bot.send_message(
                chat_id=chat_id,
                text="⏰ คำขอ OTP หมดอายุแล้ว\n\nกรุณากลับไปที่หน้าเว็บและขอ OTP ใหม่ครับ"
            )
            return

        # Generate OTP and store chat_id
        otp = str(_secrets.randbelow(900000) + 100000)
        session.otp_code = otp
        session.telegram_chat_id = chat_id
        db.commit()

        await bot_module.send_wallet_otp(chat_id, otp, username)

    except Exception as e:
        logger.error(f"Error in _handle_wallet_otp_by_username: {e}")
        try:
            await otp_bot.send_message(
                chat_id=chat_id,
                text="❌ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้งครับ"
            )
        except Exception:
            pass
    finally:
        db.close()
