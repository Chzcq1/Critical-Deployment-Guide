import logging
import base64
import io
from typing import Optional
from backend.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

_bot = None


def get_bot():
    global _bot
    if _bot is None:
        if not settings.bot_token:
            raise RuntimeError("BOT_TOKEN is not configured. Set the BOT_TOKEN environment variable.")
        from telegram import Bot
        _bot = Bot(token=settings.bot_token)
    return _bot


async def send_approval_request(
    order_id: int,
    product_name: str,
    customer_id: int,
    customer_username: Optional[str],
    customer_first_name: Optional[str],
    payment_proof: str,
    payment_type: str,
) -> Optional[int]:
    if not settings.bot_token or not settings.admin_group_id:
        logger.warning("Bot not configured — skipping admin notification")
        return None

    from telegram import InlineKeyboardButton, InlineKeyboardMarkup
    from telegram.error import TelegramError

    bot = get_bot()
    display_name = customer_first_name or customer_username or (f"ID:{customer_id}" if customer_id else "ไม่ระบุ")
    username_str = f"@{customer_username}" if customer_username else "ไม่มี username"
    proof_label = "สลีปโอนเงิน" if payment_type == "slip" else "ลิงก์ TrueMoney"
    customer_info = f"ID: {customer_id}" if customer_id else "ไม่มี Telegram ID"

    caption = (
        f"🛒 ออเดอร์ใหม่ #{order_id}\n\n"
        f"👤 ลูกค้า: {display_name}\n"
        f"📱 Telegram: {username_str}\n"
        f"🔑 {customer_info}\n"
        f"📦 สินค้า: {product_name}\n"
        f"💳 ประเภทการชำระ: {proof_label}"
    )

    keyboard = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("✅ อนุมัติ", callback_data=f"approve:{order_id}"),
            InlineKeyboardButton("❌ ปฏิเสธ", callback_data=f"reject:{order_id}"),
        ]
    ])

    try:
        if payment_type == "slip" and payment_proof.startswith("data:image"):
            header, b64data = payment_proof.split(",", 1)
            image_bytes = base64.b64decode(b64data)
            photo_file = io.BytesIO(image_bytes)
            photo_file.name = f"slip_order_{order_id}.jpg"
            msg = await bot.send_photo(
                chat_id=settings.admin_group_id,
                photo=photo_file,
                caption=caption,
                reply_markup=keyboard,
            )
        elif payment_type == "truemoney":
            text = caption + f"\n\n🔗 ลิงก์: {payment_proof}"
            msg = await bot.send_message(
                chat_id=settings.admin_group_id,
                text=text,
                reply_markup=keyboard,
            )
        else:
            msg = await bot.send_message(
                chat_id=settings.admin_group_id,
                text=caption + f"\n\n{proof_label}: {payment_proof}",
                reply_markup=keyboard,
            )
        return msg.message_id
    except TelegramError as e:
        logger.error(f"Failed to send approval request: {e}")
        return None


async def generate_invite_links(order_id: int, group_ids_str: str) -> list[str]:
    """สร้างลิงก์เชิญสำหรับกลุ่ม Telegram ทั้งหมด (ใช้ครั้งเดียว) — ไม่ต้องส่ง DM"""
    if not settings.bot_token:
        logger.warning("Bot not configured — cannot create invite links")
        return []

    from telegram.error import TelegramError
    bot = get_bot()

    group_ids = [g.strip() for g in group_ids_str.split(",") if g.strip()]
    invite_links = []

    for group_id in group_ids:
        try:
            link = await bot.create_chat_invite_link(
                chat_id=int(group_id),
                member_limit=1,
                name=f"Order #{order_id}",
            )
            invite_links.append(link.invite_link)
            logger.info(f"Created invite link for order #{order_id}, group {group_id}")
        except TelegramError as e:
            logger.error(f"Failed to create invite link for group {group_id}: {e}")

    return invite_links


async def approve_order(order_id: int, customer_id: int, group_ids_str: str) -> bool:
    """ส่งลิงก์เข้ากลุ่มให้ลูกค้าทาง DM (ใช้เมื่อมี telegram_user_id)"""
    if not settings.bot_token:
        return False
    if not customer_id:
        return False

    from telegram.error import TelegramError
    bot = get_bot()

    invite_links = await generate_invite_links(order_id, group_ids_str)

    if invite_links:
        links_text = "\n".join(invite_links)
        message = (
            f"✅ ออเดอร์ #{order_id} ได้รับการอนุมัติแล้ว!\n\n"
            f"🔗 ลิงก์เข้ากลุ่ม (ใช้ได้ครั้งเดียว — ห้ามแชร์):\n\n{links_text}"
        )
    else:
        message = f"✅ ออเดอร์ #{order_id} ได้รับการอนุมัติแล้ว! ติดต่อแอดมินเพื่อรับลิงก์เข้ากลุ่ม"

    try:
        await bot.send_message(chat_id=customer_id, text=message)
        return True
    except TelegramError as e:
        logger.error(f"Failed to send DM to {customer_id}: {e}")
        return False


async def reject_order(order_id: int, customer_id: int) -> bool:
    if not settings.bot_token:
        return False

    if not customer_id:
        logger.warning(f"No Telegram user_id for order #{order_id} — cannot DM customer")
        return False

    from telegram.error import TelegramError
    bot = get_bot()

    try:
        await bot.send_message(
            chat_id=customer_id,
            text=(
                f"❌ ออเดอร์ #{order_id} ไม่ได้รับการอนุมัติ\n\n"
                f"กรุณาตรวจสอบข้อมูลการชำระเงินแล้วลองใหม่ หรือติดต่อแอดมิน"
            ),
        )
        return True
    except TelegramError as e:
        logger.error(f"Failed to send rejection DM to {customer_id}: {e}")
        return False


async def send_otp(telegram_id: int, otp_code: str) -> tuple[bool, str]:
    """Returns (success, error_message). error_message is empty string on success."""
    if not settings.bot_token:
        msg = "BOT_TOKEN ไม่ได้ตั้งค่า"
        logger.warning(msg)
        return False, msg
    if not settings.admin_group_id:
        msg = "ADMIN_GROUP_ID ไม่ได้ตั้งค่า"
        logger.warning(msg)
        return False, msg

    from telegram.error import TelegramError
    bot = get_bot()

    try:
        await bot.send_message(
            chat_id=settings.admin_group_id,
            text=(
                f"🔐 คำขอเข้าสู่ระบบแอดมิน\n\n"
                f"รหัส OTP: <b>{otp_code}</b>\n\n"
                f"⏰ หมดอายุใน 5 นาที"
            ),
            parse_mode="HTML",
        )
        return True, ""
    except TelegramError as e:
        logger.error(f"Failed to send OTP: {e}")
        return False, str(e)


async def send_finance_notification(action: str, description: str, amount: float, admin_name: str) -> bool:
    if not settings.bot_token or not settings.admin_group_id:
        return False
    from telegram.error import TelegramError
    bot = get_bot()
    sign = "+" if amount >= 0 else ""
    emoji = "💰" if amount >= 0 else "💸"
    try:
        await bot.send_message(
            chat_id=settings.admin_group_id,
            text=(
                f"{emoji} <b>{action}</b>\n\n"
                f"📝 {description}\n"
                f"👤 แอดมิน: {admin_name}\n"
                f"💵 จำนวน: {sign}฿{abs(amount):,.2f}"
            ),
            parse_mode="HTML",
        )
        return True
    except TelegramError as e:
        logger.error(f"Failed to send finance notification: {e}")
        return False


async def send_topup_request(
    topup_id: int,
    customer_username: str,
    amount_hint: float | None,
    topup_type: str,
    voucher_code: Optional[str] = None,
) -> None:
    if not settings.bot_token or not settings.admin_group_id:
        logger.warning("Bot not configured — skipping topup notification")
        return
    from telegram.error import TelegramError
    bot = get_bot()
    type_label = "สลีปโอนเงิน" if topup_type == "slip" else "🧧 ซองอั่งเปา TrueMoney"
    amount_str = f"฿{amount_hint:,.0f}" if amount_hint else "ไม่ระบุ"
    extra = f"\n🔑 Voucher: <code>{voucher_code}</code>" if voucher_code else ""
    try:
        await bot.send_message(
            chat_id=settings.admin_group_id,
            text=(
                f"💳 <b>คำขอเติมเครดิตใหม่ #{topup_id}</b>\n\n"
                f"👤 @{customer_username}\n"
                f"ประเภท: {type_label}\n"
                f"จำนวน: {amount_str}"
                f"{extra}\n\n"
                f"กรุณาตรวจสอบและอนุมัติในแผงแอดมิน"
            ),
            parse_mode="HTML",
        )
    except TelegramError as e:
        logger.error(f"Failed to send topup notification: {e}")


async def send_topup_success(
    topup_id: int,
    customer_username: str,
    amount: float,
    topup_type: str,
    voucher_code: Optional[str] = None,
) -> None:
    if not settings.bot_token or not settings.admin_group_id:
        return
    from telegram.error import TelegramError
    bot = get_bot()
    type_label = "สลีปโอนเงิน" if topup_type == "slip" else "🧧 ซองอั่งเปา TrueMoney"
    extra = f"\n🔑 Voucher: <code>{voucher_code}</code>" if voucher_code else ""
    try:
        await bot.send_message(
            chat_id=settings.admin_group_id,
            text=(
                f"✅ <b>เติมเครดิตอัตโนมัติสำเร็จ #{topup_id}</b>\n\n"
                f"👤 @{customer_username}\n"
                f"ประเภท: {type_label}\n"
                f"ยอด: ฿{amount:,.2f}"
                f"{extra}"
            ),
            parse_mode="HTML",
        )
    except TelegramError as e:
        logger.error(f"Failed to send topup success notification: {e}")


async def setup_webhook(webhook_url: str) -> bool:
    if not settings.bot_token:
        logger.warning("BOT_TOKEN not set — skipping webhook setup")
        return False

    from telegram.error import TelegramError
    bot = get_bot()

    try:
        await bot.set_webhook(url=webhook_url)
        logger.info(f"Webhook set to {webhook_url}")
        return True
    except TelegramError as e:
        logger.error(f"Failed to set webhook: {e}")
        return False
