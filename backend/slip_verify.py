import logging
import os
import httpx
from backend.config import get_settings

logger = logging.getLogger(__name__)

# Slip2Go API — configurable via SLIP2GO_API_URL env var
# Full endpoint: POST {base}/api/verify-slip/qr-base64/info
# Auth:  Authorization: Bearer {SLIP2GO_API_KEY}
# Body:  {"image": "<raw_base64_no_data_uri_prefix>"}
SLIP2GO_BASE = os.environ.get("SLIP2GO_API_URL", "https://app.slip2go.com").rstrip("/")

AMOUNT_TOLERANCE = 0.01

# Slip2Go response codes
# Success: 200000 (Slip Found), 200001 (Get Info Success), 200200 (Slip is Valid)
# Failure: 200401 (wrong receiver), 200402 (amount mismatch), 200403 (date mismatch),
#          200404 (not found), 200500 (fraud), 200501 (duplicate)
SUCCESS_CODES = {"200000", "200001", "200200"}
CODE_MAP = {
    "200401": ("wrong_receiver", "บัญชีผู้รับไม่ถูกต้อง"),
    "200402": ("amount_mismatch", "ยอดโอนเงินไม่ตรงเงื่อนไข"),
    "200403": ("date_mismatch", "วันที่โอนไม่ตรงเงื่อนไข"),
    "200404": ("not_found", "ไม่พบข้อมูลสลิปในระบบธนาคาร"),
    "200500": ("fraud", "สลิปเสีย / สลิปปลอม"),
    "200501": ("duplicate", "สลิปซ้ำ"),
}


def _clean_no(s: str) -> str:
    return s.replace("-", "").replace(" ", "").strip()


def _parse_sender(sender: dict) -> tuple[str | None, str | None]:
    """Return (name, bank_name) from Slip2Go sender object."""
    if not sender:
        return None, None
    acct = sender.get("account") or {}
    name = acct.get("name")
    bank = sender.get("bank") or {}
    bank_name = bank.get("name") or bank.get("id")
    return name, bank_name


def _parse_receiver(receiver: dict) -> tuple[str | None, str | None, str | None]:
    """Return (name, bank_name, masked_account) from Slip2Go receiver object."""
    if not receiver:
        return None, None, None
    acct = receiver.get("account") or {}
    name = acct.get("name")
    bank = receiver.get("bank") or {}
    bank_name = bank.get("name") or bank.get("id")
    # Masked account is nested: receiver.account.bank.account
    acct_bank = acct.get("bank") or {}
    masked_acct = acct_bank.get("account") or ""
    return name, bank_name, masked_acct


async def verify_slip(
    base64_image: str,
    expected_amount: float | None = None,
    bank_account: str | None = None,
    bank_code: str | None = None,
) -> dict:
    """
    Verify a Thai bank slip using Slip2Go API.

    Response uses HTTP 200 always — success is determined by `code` field:
      200000 / 200001 / 200200  → verified
      200401–200501             → failed (see CODE_MAP)
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
    logger.info(f"Slip2Go: POST {url}")

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
                    msg = f"Slip2Go endpoint ไม่ถูกต้อง (HTTP 404) — ตรวจสอบ SLIP2GO_API_URL"
                elif resp.status_code == 405:
                    msg = f"Slip2Go endpoint ผิด method (HTTP 405)"
                else:
                    msg = f"Slip2Go ตอบกลับไม่ใช่ JSON (HTTP {resp.status_code}): {raw_text[:120]}"
                return {**base_result, "success": False, "status": "error",
                        "error_message": msg}

    except Exception as e:
        logger.error(f"Slip2Go request error: {e}")
        return {**base_result, "success": False, "status": "error",
                "error_message": f"เชื่อมต่อ Slip2Go ไม่ได้: {e}"}

    logger.info(f"Slip2Go response code={data.get('code')} msg={data.get('message')}")

    # ── Parse response ────────────────────────────────────────────────────────
    code = str(data.get("code", ""))
    slip_data = data.get("data") or {}

    # Amount
    raw_amount = slip_data.get("amount")
    try:
        slip_amount: float | None = float(raw_amount) if raw_amount is not None else None
    except (TypeError, ValueError):
        slip_amount = None

    amount_match: bool | None = None
    if expected_amount is not None and slip_amount is not None:
        amount_match = abs(slip_amount - float(expected_amount)) <= AMOUNT_TOLERANCE

    # Sender & Receiver — using Slip2Go's actual nested structure
    sender_name, sender_bank = _parse_sender(slip_data.get("sender") or {})
    receiver_name, receiver_bank, masked_acct = _parse_receiver(slip_data.get("receiver") or {})

    # Receiver account matching (best-effort against masked digits)
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

    result = {
        **base_result,
        "raw": data,
        "trans_ref": slip_data.get("transRef"),
        "date_time": slip_data.get("dateTime"),
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

    # ── Determine status from code (NOT from a `success` field) ──────────────
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
