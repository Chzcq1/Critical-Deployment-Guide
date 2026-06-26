import logging
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
    display_name = customer_first_name or customer_username or str(customer_id)
    username_str = f"@{customer_username}" if customer_username else "no username"
    proof_label = "Payment Slip" if payment_type == "slip" else "TrueMoney Link"

    text = (
        f"New Order #{order_id}\n\n"
        f"Customer: {display_name} ({username_str})\n"
        f"Telegram ID: {customer_id}\n"
        f"Product: {product_name}\n"
        f"{proof_label}:\n{payment_proof}"
    )

    keyboard = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("Approve", callback_data=f"approve:{order_id}"),
            InlineKeyboardButton("Reject", callback_data=f"reject:{order_id}"),
        ]
    ])

    try:
        msg = await bot.send_message(
            chat_id=settings.admin_group_id,
            text=text,
            reply_markup=keyboard,
        )
        return msg.message_id
    except TelegramError as e:
        logger.error(f"Failed to send approval request: {e}")
        return None


async def approve_order(order_id: int, customer_id: int, group_ids_str: str) -> bool:
    if not settings.bot_token:
        logger.warning("Bot not configured — skipping customer DM")
        return False

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
        except TelegramError as e:
            logger.error(f"Failed to create invite link for group {group_id}: {e}")

    if invite_links:
        links_text = "\n".join(f"{link}" for link in invite_links)
        message = (
            f"Your payment for Order #{order_id} has been approved!\n\n"
            f"Access links (single-use — do not share):\n\n{links_text}"
        )
    else:
        message = f"Your payment for Order #{order_id} has been approved! Contact support for your access links."

    try:
        await bot.send_message(chat_id=customer_id, text=message)
        return True
    except TelegramError as e:
        logger.error(f"Failed to send DM to {customer_id}: {e}")
        return False


async def reject_order(order_id: int, customer_id: int) -> bool:
    if not settings.bot_token:
        return False

    from telegram.error import TelegramError
    bot = get_bot()

    try:
        await bot.send_message(
            chat_id=customer_id,
            text=(
                f"Your payment for Order #{order_id} has been rejected.\n\n"
                f"Please check your payment details and try again, or contact support."
            ),
        )
        return True
    except TelegramError as e:
        logger.error(f"Failed to send rejection DM to {customer_id}: {e}")
        return False


async def send_otp(telegram_id: int, otp_code: str) -> bool:
    if not settings.bot_token or not settings.admin_group_id:
        logger.warning("Bot not configured — cannot send OTP")
        return False

    from telegram.error import TelegramError
    bot = get_bot()

    try:
        await bot.send_message(
            chat_id=settings.admin_group_id,
            text=(
                f"Admin OTP Request\n\n"
                f"Telegram ID {telegram_id} is requesting admin access.\n\n"
                f"OTP Code: {otp_code}\n\n"
                f"Expires in 5 minutes."
            ),
        )
        return True
    except TelegramError as e:
        logger.error(f"Failed to send OTP: {e}")
        return False


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
