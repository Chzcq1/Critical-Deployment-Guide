import logging
import os
import httpx
from backend.config import get_settings

logger = logging.getLogger(__name__)

# Slip2Go API (confirmed from official docs)
# Endpoint : POST https://connect.slip2go.com/api/verify-slip/qr-base64/info
# Auth     : Authorization: Bearer {secretKey}
# Body     : {"payload": {"imageBase64": "data:image/jpeg;base64,..."}}
# Response : HTTP always 200; success determined by numeric `code` field
SLIP2GO_BASE = os.environ.get("SLIP2GO_API_URL", "https://connect.slip2go.com").rstrip("/")

AMOUNT_TOLERANCE = 0.01

# Slip2Go numeric response codes
SUCCESS_CODES = {"200000", "200001", "200200", "200202"}
CODE_MAP = {
    "200401": ("wrong_receiver",    "บัญชีผู้รับไม่ถูกต้อง"),
    "200402": ("amount_mismatch",   "ยอดโอนเงินไม่ตรงเงื่อนไข"),
    "200403": ("date_mismatch",     "วันที่โอนไม่ตรงเงื่อนไข"),
    "200404": ("not_found",         "ไม่พบข้อมูลสลิปในระบบธนาคาร"),
    "200500": ("fraud",             "สลิปเสีย / สลิปปลอม"),
    "200501": ("duplicate",         "สลิปซ้ำ"),
    "200502": ("bank_error",        "Error จากธนาคาร กรุณาลองใหม่"),
}


def _clean_no(s: str) -> str:
    return s.replace("-", "").replace(" ", "").strip()


def _parse_name(party: dict) -> str | None:
    if not party:
        return None
    return party.get("name") or party.get("displayName")


def _parse_bank(party: dict) -> str | None:
    if not party:
        return None
    bank = party.get("bank") or {}
    return bank.get("name") or bank.get("id")


def _parse_account_no(party: dict) -> str | None:
    if not party:
        return None
    acct = party.get("account") or {}
    # accountNumber may be nested under account or at party level
    return acct.get("accountNumber") or acct.get("value") or party.get("accountNumber")


def _parse_amount(amount_field) -> float | None:
    if amount_field is None:
        return None
    if isinstance(amount_field, (int, float)):
        return float(amount_field)
    if isinstance(amount_field, dict):
        val = amount_field.get("amount")
        if val is not None:
            try:
                return float(val)
            except (TypeError, ValueError):
                pass
    return None


async def verify_slip(
    base64_image: str,
    expected_amount: float | None = None,
    bank_account: str | None = None,
    bank_code: str | None = None,
) -> dict:
    """
    Verify a Thai bank slip via Slip2Go API.

    Endpoint : POST https://connect.slip2go.com/api/verify-slip/qr-base64/info
    Body     : {"payload": {"imageBase64": "data:image/jpeg;base64,..."}}
    Auth     : Authorization: Bearer {SLIP2GO_API_KEY}
    Response : HTTP 200 always; success = code in {200000, 200001, 200200, 200202}
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

    # Slip2Go requires the full data URI prefix (data:image/jpeg;base64,...)
    img_data = base64_image
    if not img_data.startswith("data:"):
        img_data = f"data:image/jpeg;base64,{img_data}"

    url = f"{SLIP2GO_BASE}/api/verify-slip/qr-base64/info"
    logger.info(f"Slip2Go: POST {url}")

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={"payload": {"imageBase64": img_data}},
            )
            logger.info(f"Slip2Go HTTP {resp.status_code} | body_len={len(resp.text)}")

            raw_text = resp.text.strip()
            if not raw_text:
                return {**base_result, "success": False, "status": "error",
                        "error_message": f"Slip2Go ตอบกลับว่างเปล่า (HTTP {resp.status_code})"}

            try:
                data = resp.json()
            except Exception:
                logger.error(f"Slip2Go non-JSON (HTTP {resp.status_code}): {raw_text[:300]}")
                if resp.status_code == 401:
                    msg = "SLIP2GO_API_KEY ไม่ถูกต้องหรือหมดอายุ (HTTP 401)"
                elif resp.status_code == 403:
                    msg = "ไม่มีสิทธิ์เข้าถึง Slip2Go API (HTTP 403)"
                elif resp.status_code == 404:
                    msg = "Slip2Go endpoint ไม่ถูกต้อง (HTTP 404) — ตรวจสอบ SLIP2GO_API_URL"
                elif resp.status_code == 405:
                    msg = "Slip2Go endpoint ผิด method (HTTP 405) — ตรวจสอบ SLIP2GO_API_URL"
                else:
                    msg = f"Slip2Go ตอบกลับไม่ใช่ JSON (HTTP {resp.status_code}): {raw_text[:120]}"
                return {**base_result, "success": False, "status": "error",
                        "error_message": msg}

    except Exception as e:
        logger.error(f"Slip2Go request error: {e}")
        return {**base_result, "success": False, "status": "error",
                "error_message": f"เชื่อมต่อ Slip2Go ไม่ได้: {e}"}

    code = str(data.get("code", ""))
    logger.info(f"Slip2Go response code={code} msg={data.get('message')}")

    # ── Parse slip data ───────────────────────────────────────────────────────
    slip_data = data.get("data") or {}

    slip_amount = _parse_amount(slip_data.get("amount"))
    amount_match: bool | None = None
    if expected_amount is not None and slip_amount is not None:
        amount_match = abs(slip_amount - float(expected_amount)) <= AMOUNT_TOLERANCE

    sender   = slip_data.get("sender") or {}
    receiver = slip_data.get("receiver") or {}

    sender_name   = _parse_name(sender)
    sender_bank   = _parse_bank(sender)
    receiver_name = _parse_name(receiver)
    receiver_bank = _parse_bank(receiver)
    masked_acct   = _parse_account_no(receiver)

    receiver_match: bool | None = None
    receiver_checked = bool(bank_account)
    if bank_account and masked_acct:
        clean_conf = _clean_no(bank_account)
        clean_resp = _clean_no(masked_acct)
        if "x" not in clean_resp.lower() and clean_resp:
            receiver_match = clean_conf == clean_resp
        else:
            digits = clean_resp.replace("x", "").replace("X", "")
            if len(digits) >= 4:
                receiver_match = clean_conf.endswith(digits[-4:])

    date_time = (slip_data.get("transDate") or slip_data.get("date")
                 or slip_data.get("dateTime") or slip_data.get("transferDate"))

    result = {
        **base_result,
        "raw": data,
        "trans_ref": slip_data.get("transRef"),
        "date_time": date_time,
        "amount": slip_amount,
        "expected_amount": expected_amount,
        "amount_match": amount_match,
        "receiver_checked": receiver_checked,
        "receiver_match": receiver_match,
        "sender_name": sender_name,
        "sender_bank": sender_bank,
        "receiver_name": receiver_name,
        "receiver_bank": receiver_bank,
    }

    if code in SUCCESS_CODES:
        result.update({"success": True, "status": "verified", "error_message": None})
    else:
        if code in CODE_MAP:
            status, msg = CODE_MAP[code]
        else:
            status = "failed"
            msg = data.get("message") or f"ตรวจสอบไม่สำเร็จ (code: {code})"
        result.update({"success": False, "status": status, "error_message": msg})

    logger.info(
        f"Slip2Go result: code={code} status={result['status']} "
        f"amount={slip_amount} expected={expected_amount} match={amount_match} "
        f"sender={sender_name} receiver={receiver_name} transRef={result['trans_ref']}"
    )
    return result
