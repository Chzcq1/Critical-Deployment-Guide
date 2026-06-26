from fastapi import APIRouter, HTTPException
from backend.schemas import TelegramUser
from backend.auth import verify_telegram_login

router = APIRouter()


@router.post("/auth/telegram")
def telegram_login(user: TelegramUser):
    data = user.model_dump()
    if not verify_telegram_login(data):
        raise HTTPException(status_code=401, detail="Invalid Telegram login data")
    return {
        "id": user.id,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "username": user.username,
        "photo_url": user.photo_url,
    }
