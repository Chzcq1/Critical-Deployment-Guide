import base64
import logging
import httpx
from backend.config import get_settings

logger = logging.getLogger(__name__)


def _extract_name(obj: dict | None) -> str | None:
    if not obj:
        return None
    account = obj.get("account") or {}
    return account.get("name") or obj.get("name")


def _extract_bank(obj: dict | None) -> str | None:
    if not obj:
        return None
    bank = obj.get("bank") or {}
    return bank.get("name") or bank.get("id")


async def verify_slip(base64_image: str) -> dict:
    """
    Verify a Thai bank slip image using SlipOK API (api.slipok.com).

    Returns:
        dict with keys:
            success      : bool
            status       : "verified" | "duplicate" | "no_qr" | "failed" | "error" | "no_config"
            error_message: str | None
            trans_ref    : str | None
            date_time    : str | None
            amount       : float | None
            sender_name  : str | None
            sender_bank  : str | None
            receiver_name: str | None
            receiver_bank: str | None
            raw          : dict  (full API response)
    """
    settings = get_settings()
    api_key = settings.slipok_api_key
    branch_id = settings.slipok_branch_id

    if not api_key or not branch_id:
        return {
            "success": False,
            "status": "no_config",
            "error_message": "SLIPOK_API_KEY หรือ SLIPOK_BRANCH_ID ยังไม่ได้ตั้งค่า",
            "trans_ref": None, "date_time": None, "amount": None,
            "sender_name": None, "sender_bank": None,
            "receiver_name": None, "receiver_bank": None,
            "raw": {},
        }

    img_data = base64_image
    if "," in img_data:
        img_data = img_data.split(",", 1)[1]

    try:
        image_bytes = base64.b64decode(img_data)
    except Exception as e:
        return {
            "success": False,
            "status": "error",
            "error_message": f"ข้อมูลรูปภาพไม่ถูกต้อง: {e}",
            "trans_ref": None, "date_time": None, "amount": None,
            "sender_name": None, "sender_bank": None,
            "receiver_name": None, "receiver_bank": None,
            "raw": {},
        }

    url = f"https://api.slipok.com/api/line/apikey/{branch_id}"

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                url,
                headers={"x-authorization": api_key},
                files={"files": ("slip.jpg", image_bytes, "image/jpeg")},
            )
            data = resp.json()
    except Exception as e:
        logger.error(f"SlipOK API error: {e}")
        return {
            "success": False,
            "status": "error",
            "error_message": f"เชื่อมต่อ SlipOK ไม่ได้: {e}",
            "trans_ref": None, "date_time": None, "amount": None,
            "sender_name": None, "sender_bank": None,
            "receiver_name": None, "receiver_bank": None,
            "raw": {},
        }

    success = data.get("success", False)
    slip_data = data.get("data") or {}

    result = {
        "raw": data,
        "trans_ref": slip_data.get("transRef"),
        "date_time": slip_data.get("dateTime") or slip_data.get("date"),
        "amount": slip_data.get("amount"),
        "sender_name": _extract_name(slip_data.get("sender")),
        "sender_bank": _extract_bank(slip_data.get("sender")),
        "receiver_name": _extract_name(slip_data.get("receiver")),
        "receiver_bank": _extract_bank(slip_data.get("receiver")),
    }

    if success:
        result.update({"success": True, "status": "verified", "error_message": None})
    else:
        code = str(data.get("code", ""))
        if code in ("1003", "400301", "400302"):
            status = "duplicate"
        elif code in ("1005", "400101"):
            status = "no_qr"
        else:
            status = "failed"
        result.update({
            "success": False,
            "status": status,
            "error_message": data.get("message") or "ตรวจสอบไม่สำเร็จ",
        })

    logger.info(f"SlipOK verify result: status={result['status']} amount={result['amount']} transRef={result['trans_ref']}")
    return result
