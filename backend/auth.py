import hashlib
import hmac
import time
from typing import Optional
from itsdangerous import URLSafeTimedSerializer
from backend.config import get_settings

settings = get_settings()


def verify_telegram_login(data: dict) -> bool:
    check_hash = data.pop("hash", None)
    if not check_hash:
        return False

    auth_date = int(data.get("auth_date", 0))
    if time.time() - auth_date > 86400:
        return False

    data_check_string = "\n".join(
        f"{k}={v}" for k, v in sorted(data.items())
    )

    secret_key = hashlib.sha256(settings.bot_token.encode()).digest()
    computed_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

    return hmac.compare_digest(computed_hash, check_hash)


def create_admin_token(telegram_id: int) -> str:
    s = URLSafeTimedSerializer(settings.secret_key)
    return s.dumps({"telegram_id": telegram_id, "role": "admin"})


def verify_admin_token(token: str) -> Optional[dict]:
    s = URLSafeTimedSerializer(settings.secret_key)
    try:
        data = s.loads(token, max_age=86400 * 7)
        return data
    except Exception:
        return None


def generate_otp() -> str:
    import secrets
    return str(secrets.randbelow(900000) + 100000)
