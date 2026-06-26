import logging
import httpx
from backend.config import get_settings

logger = logging.getLogger(__name__)

SLIP2GO_BASE = "https://api.slip2go.com"
AMOUNT_TOLERANCE = 0.01


def _extract_name(obj: dict | None) -> str | None:
    if not obj:
        return None
    return obj.get("name") or obj.get("accountName")


def _extract_bank(obj: dict | None) -> str | None:
    if not obj:
        return None
    bank = obj.get("bank") or {}
    return bank.get("name") or bank.get("code")


def _clean_account_no(account: str) -> str:
    return account.replace("-", "").replace(" ", "").strip()


async def verify_slip(
    base64_image: str,
    expected_amount: float | None = None,
    bank_account: str | None = None,
    bank_code: str | None = None,
) -> dict:
    """
    Verify a Thai bank slip image using Slip2Go API (api.slip2go.com).

    Args:
        base64_image   : base64 string (with or without data URI prefix)
        expected_amount: product price in THB — compared against slip amount
        bank_account   : store's bank account number or PromptPay number
        bank_code      : Slip2Go bank code (e.g. "01004" = KBank) or "promptpay"

    Returns dict with:
        success        : bool
        status         : "verified" | "wrong_receiver" | "wrong_amount" |
                         "duplicate" | "no_qr" | "failed" | "error" | "no_config"
        error_message  : str | None
        trans_ref      : str | None
        date_time      : str | None
        amount         : float | None   (actual amount on slip)
        expected_amount: float | None   (product price)
        amount_match   : bool | None
        receiver_checked: bool          (True if checkReceiver was sent)
        sender_name    : str | None
        sender_bank    : str | None
        receiver_name  : str | None
        receiver_bank  : str | None
        raw            : dict
    """
    settings = get_settings()
    api_key = settings.slip2go_api_key

    base_result = {
        "trans_ref": None, "date_time": None, "amount": None,
        "expected_amount": expected_amount, "amount_match": None,
        "receiver_checked": False,
        "sender_name": None, "sender_bank": None,
        "receiver_name": None, "receiver_bank": None,
        "raw": {},
    }

    if not api_key:
        return {**base_result, "success": False, "status": "no_config",
                "error_message": "SLIP2GO_API_KEY ยังไม่ได้ตั้งค่า"}

    img_data = base64_image
    if "," in img_data:
        img_data = img_data.split(",", 1)[1]

    # Build checkCondition
    check_condition: dict = {}
    receiver_checked = False
    if bank_account and bank_code:
        clean_acc = _clean_account_no(bank_account)
        if bank_code == "promptpay":
            check_condition["checkReceiver"] = [{"promptPayNo": clean_acc}]
        else:
            check_condition["checkReceiver"] = [
                {"accountType": bank_code, "accountNo": clean_acc}
            ]
        receiver_checked = True

    payload: dict = {"imageBase64": img_data}
    if check_condition:
        payload["checkCondition"] = check_condition

    url = f"{SLIP2GO_BASE}/api/verify-slip/base64/info"

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                url,
                headers={"Authorization": api_key, "Content-Type": "application/json"},
                json={"payload": payload},
            )
            data = resp.json()
    except Exception as e:
        logger.error(f"Slip2Go API error: {e}")
        return {**base_result, "success": False, "status": "error",
                "error_message": f"เชื่อมต่อ Slip2Go ไม่ได้: {e}",
                "receiver_checked": receiver_checked}

    success = data.get("success", False)
    slip_data = data.get("data") or {}

    slip_amount = slip_data.get("amount")
    try:
        slip_amount = float(slip_amount) if slip_amount is not None else None
    except (TypeError, ValueError):
        slip_amount = None

    amount_match: bool | None = None
    if expected_amount is not None and slip_amount is not None:
        amount_match = abs(slip_amount - float(expected_amount)) <= AMOUNT_TOLERANCE

    result = {
        **base_result,
        "raw": data,
        "trans_ref": slip_data.get("transRef"),
        "date_time": slip_data.get("dateTime") or slip_data.get("date"),
        "amount": slip_amount,
        "expected_amount": expected_amount,
        "amount_match": amount_match,
        "receiver_checked": receiver_checked,
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
        msg_lower = msg.lower()
        if "receiver" in msg_lower or "บัญชีผู้รับ" in msg or code in ("WRONG_RECEIVER", "1014"):
            status = "wrong_receiver"
        elif "duplicate" in msg_lower or "ซ้ำ" in msg or code in ("DUPLICATE", "1012"):
            status = "duplicate"
        elif "qr" in msg_lower or "qrcode" in msg_lower or code in ("NO_QR", "1005"):
            status = "no_qr"
        else:
            status = "failed"
        result.update({"success": False, "status": status, "error_message": msg})

    logger.info(
        f"Slip2Go verify: status={result['status']} slip_amount={slip_amount} "
        f"expected={expected_amount} match={amount_match} "
        f"receiver_checked={receiver_checked} transRef={result['trans_ref']}"
    )
    return result
