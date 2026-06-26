import logging
import httpx
from backend.config import get_settings

logger = logging.getLogger(__name__)

SLIP2GO_BASE = "https://api.slip2go.com"


def _extract_name(obj: dict | None) -> str | None:
    if not obj:
        return None
    return obj.get("name") or obj.get("accountName")


def _extract_bank(obj: dict | None) -> str | None:
    if not obj:
        return None
    bank = obj.get("bank") or {}
    return bank.get("name") or bank.get("code")


async def verify_slip(base64_image: str) -> dict:
    """
    Verify a Thai bank slip image using Slip2Go API (api.slip2go.com).

    Sends a base64-encoded image to the /api/verify-slip/base64/info endpoint.
    Auth: Header  Authorization: <secret_key>

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
    api_key = settings.slip2go_api_key

    if not api_key:
        return {
            "success": False,
            "status": "no_config",
            "error_message": "SLIP2GO_API_KEY ยังไม่ได้ตั้งค่า",
            "trans_ref": None, "date_time": None, "amount": None,
            "sender_name": None, "sender_bank": None,
            "receiver_name": None, "receiver_bank": None,
            "raw": {},
        }

    img_data = base64_image
    if "," in img_data:
        img_data = img_data.split(",", 1)[1]

    url = f"{SLIP2GO_BASE}/api/verify-slip/base64/info"

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                url,
                headers={
                    "Authorization": api_key,
                    "Content-Type": "application/json",
                },
                json={"payload": {"imageBase64": img_data}},
            )
            data = resp.json()
    except Exception as e:
        logger.error(f"Slip2Go API error: {e}")
        return {
            "success": False,
            "status": "error",
            "error_message": f"เชื่อมต่อ Slip2Go ไม่ได้: {e}",
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
        msg = data.get("message") or data.get("error") or "ตรวจสอบไม่สำเร็จ"
        if "duplicate" in msg.lower() or code in ("4003", "DUPLICATE"):
            status = "duplicate"
        elif "qr" in msg.lower() or "qrcode" in msg.lower() or code in ("4001", "NO_QR"):
            status = "no_qr"
        else:
            status = "failed"
        result.update({
            "success": False,
            "status": status,
            "error_message": msg,
        })

    logger.info(f"Slip2Go verify result: status={result['status']} amount={result['amount']} transRef={result['trans_ref']}")
    return result
