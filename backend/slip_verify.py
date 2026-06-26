import logging
import httpx
from backend.config import get_settings

logger = logging.getLogger(__name__)

# Correct Slip2Go API base — app.slip2go.com NOT api.slip2go.com
SLIP2GO_BASE = "https://app.slip2go.com"
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


def _clean_no(s: str) -> str:
    return s.replace("-", "").replace(" ", "").strip()


async def verify_slip(
    base64_image: str,
    expected_amount: float | None = None,
    bank_account: str | None = None,
    bank_code: str | None = None,
) -> dict:
    """
    Verify a Thai bank slip image using Slip2Go API (app.slip2go.com).

    Endpoint: POST /api/verify-slip/base64/info
    Auth   : Authorization: <secret_key>  (no Bearer prefix)
    Body   : { "payload": { "imageBase64": "<raw_base64_without_prefix>" } }

    Args:
        base64_image   : base64 string (with or without data URI prefix)
        expected_amount: product price — compared against slip amount
        bank_account   : store's bank account / PromptPay number for receiver check
        bank_code      : not used in API call; used for manual receiver hint only

    Returns dict with: success, status, error_message, trans_ref, date_time,
                       amount, expected_amount, amount_match,
                       receiver_checked, receiver_match,
                       sender_name, sender_bank,
                       receiver_name, receiver_bank, raw
    """
    settings = get_settings()
    api_key = settings.slip2go_api_key

    base_result: dict = {
        "trans_ref": None, "date_time": None, "amount": None,
        "expected_amount": expected_amount, "amount_match": None,
        "receiver_checked": False, "receiver_match": None,
        "sender_name": None, "sender_bank": None,
        "receiver_name": None, "receiver_bank": None,
        "raw": {},
    }

    if not api_key:
        return {**base_result, "success": False, "status": "no_config",
                "error_message": "SLIP2GO_API_KEY ยังไม่ได้ตั้งค่าใน Secrets"}

    # Strip data URI prefix — Slip2Go expects raw base64
    img_data = base64_image
    if "," in img_data:
        img_data = img_data.split(",", 1)[1]

    url = f"{SLIP2GO_BASE}/api/verify-slip/base64/info"

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                url,
                headers={"Authorization": api_key, "Content-Type": "application/json"},
                json={"payload": {"imageBase64": img_data}},
            )
            logger.info(f"Slip2Go HTTP {resp.status_code} | body_len={len(resp.text)}")

            # Guard against non-JSON or empty responses (e.g. 401, 403, 5xx HTML pages)
            raw_text = resp.text.strip()
            if not raw_text:
                logger.error(f"Slip2Go returned empty body (HTTP {resp.status_code})")
                return {**base_result, "success": False, "status": "error",
                        "error_message": f"Slip2Go ตอบกลับว่างเปล่า (HTTP {resp.status_code}) — ตรวจสอบ API Key ให้ถูกต้อง"}

            try:
                data = resp.json()
            except Exception as parse_err:
                logger.error(f"Slip2Go non-JSON response (HTTP {resp.status_code}): {raw_text[:300]}")
                # Common causes: wrong key → 401 HTML, IP blocked, wrong endpoint
                if resp.status_code == 401:
                    msg = "SLIP2GO_API_KEY ไม่ถูกต้องหรือหมดอายุ (HTTP 401)"
                elif resp.status_code == 403:
                    msg = "ไม่มีสิทธิ์เข้าถึง Slip2Go API (HTTP 403)"
                else:
                    msg = f"Slip2Go ตอบกลับไม่ใช่ JSON (HTTP {resp.status_code}): {raw_text[:100]}"
                return {**base_result, "success": False, "status": "error",
                        "error_message": msg}

    except Exception as e:
        logger.error(f"Slip2Go API error: {e}")
        return {**base_result, "success": False, "status": "error",
                "error_message": f"เชื่อมต่อ Slip2Go ไม่ได้: {e}"}

    success = data.get("success", False)
    slip_data = data.get("data") or {}

    # Parse amount
    raw_amount = slip_data.get("amount")
    try:
        slip_amount: float | None = float(raw_amount) if raw_amount is not None else None
    except (TypeError, ValueError):
        slip_amount = None

    # Amount comparison
    amount_match: bool | None = None
    if expected_amount is not None and slip_amount is not None:
        amount_match = abs(slip_amount - float(expected_amount)) <= AMOUNT_TOLERANCE

    # Receiver info from response
    receiver_obj = slip_data.get("receiver") or {}
    receiver_name = _extract_name(receiver_obj)
    receiver_bank = _extract_bank(receiver_obj)

    # Manual receiver account matching (Slip2Go may mask the account, so best-effort)
    receiver_match: bool | None = None
    receiver_checked = bool(bank_account)
    if bank_account and receiver_obj:
        acct_obj = receiver_obj.get("account") or {}
        acct_val = acct_obj.get("value") or ""
        # Compare only the unmasked trailing digits
        clean_conf = _clean_no(bank_account)
        clean_resp = _clean_no(acct_val)
        # Match if configured account ends with the unmasked digits (or full match)
        if clean_resp and "x" not in clean_resp.lower():
            receiver_match = clean_conf == clean_resp
        elif clean_resp:
            # Slip2Go masks middle digits: compare last 4 digits at minimum
            digits_resp = clean_resp.replace("x", "").replace("X", "")
            if len(digits_resp) >= 3:
                receiver_match = clean_conf.endswith(digits_resp[-4:]) if len(digits_resp) >= 4 else None

    result = {
        **base_result,
        "raw": data,
        "trans_ref": slip_data.get("transRef"),
        "date_time": slip_data.get("dateTime") or slip_data.get("date"),
        "amount": slip_amount,
        "expected_amount": expected_amount,
        "amount_match": amount_match,
        "receiver_checked": receiver_checked,
        "receiver_match": receiver_match,
        "sender_name": _extract_name(slip_data.get("sender")),
        "sender_bank": _extract_bank(slip_data.get("sender")),
        "receiver_name": receiver_name,
        "receiver_bank": receiver_bank,
    }

    if success:
        result.update({"success": True, "status": "verified", "error_message": None})
    else:
        code = str(data.get("code", ""))
        msg = str(data.get("message") or data.get("error") or "ตรวจสอบไม่สำเร็จ")
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
        f"Slip2Go verify: status={result['status']} amount={slip_amount} "
        f"expected={expected_amount} match={amount_match} "
        f"receiver_match={receiver_match} transRef={result['trans_ref']}"
    )
    return result
