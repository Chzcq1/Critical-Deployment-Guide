import logging
import httpx
from backend.config import get_settings

logger = logging.getLogger(__name__)

# slip2go.com — base URL (no subdomain)
# Endpoint ref: https://slip2go.com/guide → verify-slip/qr-base64/info
SLIP2GO_BASE = "https://slip2go.com"
AMOUNT_TOLERANCE = 0.01


def _extract_name(obj: dict | None) -> str | None:
    if not obj:
        return None
    return obj.get("name") or obj.get("accountName")


def _extract_bank(obj: dict | None) -> str | None:
    if not obj:
        return None
    bank = obj.get("bank") or {}
    if isinstance(bank, str):
        return bank
    return bank.get("name") or bank.get("code") or bank.get("short")


def _clean_no(s: str) -> str:
    return s.replace("-", "").replace(" ", "").strip()


async def verify_slip(
    base64_image: str,
    expected_amount: float | None = None,
    bank_account: str | None = None,
    bank_code: str | None = None,
) -> dict:
    """
    Verify a Thai bank slip image using Slip2Go API.

    Endpoint : POST https://slip2go.com/api/verify-slip/base64
    Auth     : Authorization: Bearer <api_key>
    Body     : { "image": "<raw_base64_without_data_uri_prefix>" }
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

    # Strip data URI prefix — Slip2Go expects raw base64 only
    img_data = base64_image
    if "," in img_data:
        img_data = img_data.split(",", 1)[1]

    url = f"{SLIP2GO_BASE}/api/verify-slip/qr-base64/info"

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={"image": img_data},
            )
            logger.info(f"Slip2Go HTTP {resp.status_code} | body_len={len(resp.text)}")

            raw_text = resp.text.strip()
            if not raw_text:
                logger.error(f"Slip2Go returned empty body (HTTP {resp.status_code})")
                return {**base_result, "success": False, "status": "error",
                        "error_message": f"Slip2Go ตอบกลับว่างเปล่า (HTTP {resp.status_code}) — ตรวจสอบ API Key"}

            try:
                data = resp.json()
            except Exception:
                logger.error(f"Slip2Go non-JSON (HTTP {resp.status_code}): {raw_text[:300]}")
                if resp.status_code == 401:
                    msg = "SLIP2GO_API_KEY ไม่ถูกต้องหรือหมดอายุ (HTTP 401)"
                elif resp.status_code == 403:
                    msg = "ไม่มีสิทธิ์เข้าถึง Slip2Go API (HTTP 403)"
                elif resp.status_code == 405:
                    msg = "Slip2Go endpoint ผิด (HTTP 405) — กรุณาแจ้งผู้พัฒนา"
                else:
                    msg = f"Slip2Go ตอบกลับไม่ใช่ JSON (HTTP {resp.status_code}): {raw_text[:120]}"
                return {**base_result, "success": False, "status": "error",
                        "error_message": msg}

    except Exception as e:
        logger.error(f"Slip2Go request error: {e}")
        return {**base_result, "success": False, "status": "error",
                "error_message": f"เชื่อมต่อ Slip2Go ไม่ได้: {e}"}

    logger.info(f"Slip2Go raw response: {str(data)[:400]}")

    success = data.get("success", False)
    # Support both nested `data` key and flat response
    slip_data = data.get("data") or {}

    # ── Amount ──────────────────────────────────────────────────────────────
    # Field may be: "amount", "transferAmount", "transactionAmount"
    raw_amount = (
        slip_data.get("amount")
        or slip_data.get("transferAmount")
        or slip_data.get("transactionAmount")
    )
    try:
        slip_amount: float | None = float(raw_amount) if raw_amount is not None else None
    except (TypeError, ValueError):
        slip_amount = None

    amount_match: bool | None = None
    if expected_amount is not None and slip_amount is not None:
        amount_match = abs(slip_amount - float(expected_amount)) <= AMOUNT_TOLERANCE

    # ── Date/Time ────────────────────────────────────────────────────────────
    date_time = (
        slip_data.get("transactionDate")
        or slip_data.get("dateTime")
        or slip_data.get("date")
        or slip_data.get("paidAt")
    )

    # ── Trans Ref ────────────────────────────────────────────────────────────
    trans_ref = (
        slip_data.get("ref")
        or slip_data.get("transRef")
        or slip_data.get("referenceNo")
        or slip_data.get("transactionId")
    )

    # ── Sender ──────────────────────────────────────────────────────────────
    sender_obj = slip_data.get("sender") or {}
    sender_name = _extract_name(sender_obj)
    sender_bank = _extract_bank(sender_obj)

    # ── Receiver ─────────────────────────────────────────────────────────────
    receiver_obj = slip_data.get("receiver") or {}
    receiver_name = _extract_name(receiver_obj)
    receiver_bank = _extract_bank(receiver_obj)

    # ── Receiver account matching (best-effort, Slip2Go masks digits) ────────
    receiver_match: bool | None = None
    receiver_checked = bool(bank_account)
    if bank_account and receiver_obj:
        acct_obj = receiver_obj.get("account") or {}
        acct_val = (
            acct_obj.get("value")
            or receiver_obj.get("accountNo")
            or receiver_obj.get("accountNumber")
            or ""
        )
        clean_conf = _clean_no(bank_account)
        clean_resp = _clean_no(acct_val)
        if clean_resp and "x" not in clean_resp.lower():
            receiver_match = clean_conf == clean_resp
        elif clean_resp:
            digits_resp = clean_resp.replace("x", "").replace("X", "")
            if len(digits_resp) >= 4:
                receiver_match = clean_conf.endswith(digits_resp[-4:])

    result = {
        **base_result,
        "raw": data,
        "trans_ref": trans_ref,
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

    if success:
        result.update({"success": True, "status": "verified", "error_message": None})
    else:
        code = str(data.get("code", "") or slip_data.get("code", ""))
        msg = str(
            data.get("message")
            or data.get("error")
            or slip_data.get("message")
            or "ตรวจสอบไม่สำเร็จ"
        )
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
        f"Slip2Go result: status={result['status']} amount={slip_amount} "
        f"expected={expected_amount} match={amount_match} "
        f"receiver_match={receiver_match} transRef={trans_ref}"
    )
    return result
