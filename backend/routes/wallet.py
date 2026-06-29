import json
import logging
import os
import re
from datetime import datetime, timedelta
from decimal import Decimal

import bcrypt
import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Query
import jwt as _jwt
from jwt.exceptions import InvalidTokenError as JWTError
from sqlalchemy.orm import Session
from sqlalchemy import desc

from backend.config import get_settings
from backend.database import get_db
from backend.models import Customer, TopupRequest, CreditTransaction, StoreSettings
from backend.routes.admin import get_admin, _get_setting

logger = logging.getLogger(__name__)
router = APIRouter()

TRUEMONEY_API = "https://gateway.autozy.app/api/giftvoucher/{code}/{phone}/"

_JWT_SECRET = os.environ.get("SECRET_KEY", "wallet-pin-secret-change-in-production")
_JWT_ALG = "HS256"
_TOKEN_EXPIRE_DAYS = 7


# ── PIN / Token helpers ───────────────────────────────────────────────────────

def _hash_pin(pin: str) -> str:
    return bcrypt.hashpw(pin.encode(), bcrypt.gensalt()).decode()


def _verify_pin(pin: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pin.encode(), hashed.encode())
    except Exception:
        return False


def _create_token(username: str) -> str:
    exp = datetime.utcnow() + timedelta(days=_TOKEN_EXPIRE_DAYS)
    return _jwt.encode({"sub": username, "exp": exp}, _JWT_SECRET, algorithm=_JWT_ALG)


def _decode_token(token: str) -> str:
    try:
        payload = _jwt.decode(token, _JWT_SECRET, algorithms=[_JWT_ALG])
        return payload["sub"]
    except JWTError:
        raise HTTPException(status_code=401, detail="กรุณาเข้าสู่ระบบใหม่ (session หมดอายุ)")


def get_wallet_customer(
    authorization: str = Header(None),
    db: Session = Depends(get_db),
) -> Customer:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="กรุณาเข้าสู่ระบบกระเป๋าเครดิตก่อน")
    token = authorization.split(" ", 1)[1]
    username = _decode_token(token)
    customer = db.query(Customer).filter(Customer.telegram_username == username).first()
    if not customer:
        raise HTTPException(status_code=401, detail="ไม่พบบัญชีผู้ใช้")
    return customer


def _normalize_username(raw: str) -> str:
    u = raw.lstrip("@").strip().lower()
    if not u:
        raise HTTPException(status_code=400, detail="กรุณาระบุ Telegram Username")
    return u


# ── Public: request OTP (new account only) ───────────────────────────────────

@router.post("/wallet/send-otp")
async def wallet_send_otp(body: dict, db: Session = Depends(get_db)):
    """
    Create an OTP session. Returns bot deep-link.
    mode='register' (default) — new accounts only.
    mode='reset'    — existing accounts with PIN (forgot PIN flow).

    If the customer already has a telegram_user_id linked, the OTP is sent
    automatically via Telegram DM and auto_sent=True is returned so the
    frontend can skip the otp_wait step entirely.
    """
    import secrets as _secrets
    from datetime import datetime, timedelta, timezone
    from backend.models import WalletOTPSession

    username = _normalize_username(body.get("username", ""))
    mode = str(body.get("mode", "register")).strip()
    settings = get_settings()

    otp_token = settings.otp_bot_token or settings.bot_token
    otp_username = settings.otp_bot_username or settings.bot_username

    if not otp_token or not otp_username:
        raise HTTPException(
            status_code=503,
            detail="ระบบ OTP ยังไม่ได้ตั้งค่า OTP_BOT_TOKEN / OTP_BOT_USERNAME — กรุณาติดต่อแอดมิน"
        )

    customer = db.query(Customer).filter(Customer.telegram_username == username).first()

    if mode == "reset":
        if not customer or not customer.pin_hash:
            raise HTTPException(status_code=404, detail="ไม่พบบัญชีนี้ หรือยังไม่มี PIN")
    else:
        if customer and customer.pin_hash:
            raise HTTPException(status_code=400, detail="บัญชีนี้มี PIN อยู่แล้ว ไม่จำเป็นต้อง OTP")

    db.query(WalletOTPSession).filter(
        WalletOTPSession.telegram_username == username,
        WalletOTPSession.is_used == False,
    ).delete(synchronize_session=False)
    db.commit()

    token = _secrets.token_hex(32)
    expires = datetime.now(timezone.utc) + timedelta(minutes=10)
    session = WalletOTPSession(
        session_token=token,
        telegram_username=username,
        expires_at=expires,
    )
    db.add(session)
    db.commit()

    bot_url = f"https://t.me/{otp_username}?start=otp_{token}"

    # Auto-send OTP for accounts that already have a linked Telegram User ID
    auto_sent = False
    if customer and customer.telegram_user_id:
        otp_code = str(_secrets.randbelow(900000) + 100000)
        session.otp_code = otp_code
        session.telegram_chat_id = customer.telegram_user_id
        db.commit()
        try:
            from backend import bot as bot_module
            await bot_module.send_wallet_otp(customer.telegram_user_id, otp_code, username)
            auto_sent = True
            logger.info(f"Auto-sent OTP for {username} (telegram_user_id={customer.telegram_user_id})")
        except Exception as e:
            logger.warning(f"Auto-send OTP failed for {username}: {e} — falling back to deep link")
            session.otp_code = None
            session.telegram_chat_id = None
            db.commit()

    return {"session_token": token, "bot_url": bot_url, "auto_sent": auto_sent}


@router.get("/wallet/otp-status/{session_token}")
def wallet_otp_status(session_token: str, db: Session = Depends(get_db)):
    """Poll whether the bot has already sent the OTP (user opened Telegram)."""
    from datetime import datetime, timezone
    from backend.models import WalletOTPSession

    session = db.query(WalletOTPSession).filter(
        WalletOTPSession.session_token == session_token,
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="ไม่พบ session")

    expires = session.expires_at
    if expires.tzinfo is None:
        from datetime import timezone as _tz
        expires = expires.replace(tzinfo=_tz.utc)
    if datetime.now(timezone.utc) > expires:
        raise HTTPException(status_code=410, detail="session หมดอายุ กรุณาขอ OTP ใหม่")

    return {"ready": session.otp_code is not None and not session.is_used}


@router.post("/wallet/verify-otp")
def wallet_verify_otp(body: dict, db: Session = Depends(get_db)):
    """Verify OTP entered by user. Returns a short-lived verified_token for account creation."""
    from datetime import datetime, timezone, timedelta
    from backend.models import WalletOTPSession

    session_token = str(body.get("session_token", "")).strip()
    otp = str(body.get("otp", "")).strip()

    if not session_token or not otp:
        raise HTTPException(status_code=400, detail="ข้อมูลไม่ครบ")

    session = db.query(WalletOTPSession).filter(
        WalletOTPSession.session_token == session_token,
        WalletOTPSession.is_used == False,
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="ไม่พบ session หรือถูกใช้ไปแล้ว")

    expires = session.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) > expires:
        raise HTTPException(status_code=410, detail="รหัส OTP หมดอายุแล้ว กรุณาขอใหม่")

    if session.otp_code is None:
        raise HTTPException(status_code=400, detail="รหัส OTP ยังไม่ถูกส่ง กรุณาเปิด Telegram ก่อน")

    if session.otp_code != otp:
        raise HTTPException(status_code=400, detail="รหัส OTP ไม่ถูกต้อง")

    session.is_used = True
    db.commit()

    verified_token = _jwt.encode(
        {
            "sub": session.telegram_username,
            "type": "wallet_otp_verified",
            "exp": datetime.utcnow() + timedelta(minutes=15),
            "tuid": session.telegram_chat_id,
        },
        _JWT_SECRET,
        algorithm=_JWT_ALG,
    )
    return {"verified": True, "verified_token": verified_token, "username": session.telegram_username}


@router.post("/wallet/reset-pin")
def wallet_reset_pin(body: dict, db: Session = Depends(get_db)):
    """Reset PIN for an existing account after OTP verification."""
    import hashlib as _hashlib

    verified_token = str(body.get("verified_token", "")).strip()
    new_pin = str(body.get("new_pin", "")).strip()
    confirm_pin = str(body.get("confirm_pin", "")).strip()

    if not new_pin or not new_pin.isdigit() or not (4 <= len(new_pin) <= 6):
        raise HTTPException(status_code=400, detail="PIN ใหม่ต้องเป็นตัวเลข 4-6 หลัก")
    if new_pin != confirm_pin:
        raise HTTPException(status_code=400, detail="PIN ไม่ตรงกัน กรุณาตรวจสอบอีกครั้ง")
    if not verified_token:
        raise HTTPException(status_code=400, detail="ไม่พบ verified_token")

    try:
        payload = _jwt.decode(verified_token, _JWT_SECRET, algorithms=[_JWT_ALG])
    except Exception:
        raise HTTPException(status_code=401, detail="Token ไม่ถูกต้องหรือหมดอายุ กรุณาขอ OTP ใหม่")

    if payload.get("type") != "wallet_otp_verified":
        raise HTTPException(status_code=401, detail="Token ประเภทไม่ถูกต้อง")

    username = payload.get("sub", "")
    customer = db.query(Customer).filter(Customer.telegram_username == username).first()
    if not customer:
        raise HTTPException(status_code=404, detail="ไม่พบบัญชีผู้ใช้")

    customer.pin_hash = _hash_pin(new_pin)
    db.commit()

    return {"success": True, "message": "รีเซ็ท PIN สำเร็จ กรุณาล็อคอินด้วย PIN ใหม่"}


# ── Public: check if account exists ──────────────────────────────────────────

@router.get("/wallet/check/{username}")
def wallet_check(username: str, db: Session = Depends(get_db)):
    """Return whether account & PIN exist — used by frontend to decide login vs register flow."""
    uname = _normalize_username(username)
    customer = db.query(Customer).filter(Customer.telegram_username == uname).first()
    if not customer or not customer.pin_hash:
        return {"exists": bool(customer), "has_pin": False}
    return {"exists": True, "has_pin": True}


# ── Public: authenticate (login / register) ───────────────────────────────────

@router.post("/wallet/auth")
def wallet_auth(body: dict, db: Session = Depends(get_db)):
    """
    Login or register a wallet account.
    - New account: creates it and sets PIN.
    - Existing account without PIN: sets PIN.
    - Existing account with PIN: verifies PIN.
    Returns a JWT token valid for 7 days.
    """
    username = _normalize_username(body.get("username", ""))
    pin = str(body.get("pin", "")).strip()
    confirm_pin = str(body.get("confirm_pin", "")).strip()

    if not pin or not pin.isdigit() or not (4 <= len(pin) <= 6):
        raise HTTPException(status_code=400, detail="PIN ต้องเป็นตัวเลข 4-6 หลัก")

    customer = db.query(Customer).filter(Customer.telegram_username == username).first()

    if not customer:
        # Brand new account — require OTP verified_token
        verified_token = str(body.get("verified_token", "")).strip()
        if not verified_token:
            raise HTTPException(
                status_code=403,
                detail="บัญชีใหม่ต้องยืนยันตัวตนผ่าน Telegram OTP ก่อน"
            )
        try:
            payload = _jwt.decode(verified_token, _JWT_SECRET, algorithms=[_JWT_ALG])
            if payload.get("type") != "wallet_otp_verified" or payload.get("sub") != username:
                raise ValueError("token mismatch")
        except Exception:
            raise HTTPException(
                status_code=403,
                detail="OTP token ไม่ถูกต้องหรือหมดอายุ กรุณายืนยัน OTP ใหม่อีกครั้ง"
            )
        if confirm_pin and pin != confirm_pin:
            raise HTTPException(status_code=400, detail="PIN ไม่ตรงกัน กรุณาตรวจสอบอีกครั้ง")
        tuid = payload.get("tuid")
        if tuid is not None:
            existing_by_id = db.query(Customer).filter(Customer.telegram_user_id == int(tuid)).first()
            if existing_by_id and existing_by_id.telegram_username != username:
                raise HTTPException(
                    status_code=400,
                    detail="Telegram account นี้ถูกผูกกับบัญชีอื่นแล้ว"
                )
        customer = Customer(
            telegram_username=username,
            telegram_user_id=int(tuid) if tuid is not None else None,
            balance=Decimal("0.00"),
            pin_hash=_hash_pin(pin),
        )
        db.add(customer)
        db.commit()
        db.refresh(customer)
        return {"token": _create_token(username), "is_new": True, "balance": 0.0}

    if not customer.pin_hash:
        # Existing account without PIN — set PIN now
        if confirm_pin and pin != confirm_pin:
            raise HTTPException(status_code=400, detail="PIN ไม่ตรงกัน กรุณาตรวจสอบอีกครั้ง")
        customer.pin_hash = _hash_pin(pin)
        db.commit()
        return {"token": _create_token(username), "is_new": False, "balance": float(customer.balance or 0)}

    # Existing account with PIN — verify
    if not _verify_pin(pin, customer.pin_hash):
        raise HTTPException(status_code=400, detail="PIN ไม่ถูกต้อง")

    return {"token": _create_token(username), "is_new": False, "balance": float(customer.balance or 0)}


# ── Protected: wallet info ────────────────────────────────────────────────────

@router.get("/wallet/me")
def get_my_wallet(
    customer: Customer = Depends(get_wallet_customer),
    db: Session = Depends(get_db),
):
    txns = (
        db.query(CreditTransaction)
        .filter(CreditTransaction.customer_id == customer.id)
        .order_by(desc(CreditTransaction.id))
        .limit(50)
        .all()
    )
    return {
        "username": customer.telegram_username,
        "balance": float(customer.balance or 0),
        "transactions": [
            {
                "id": t.id,
                "type": t.txn_type,
                "amount": float(t.amount),
                "description": t.description,
                "created_at": t.created_at.isoformat() if t.created_at else None,
            }
            for t in txns
        ],
    }


# ── Protected: top-up via slip ────────────────────────────────────────────────

@router.post("/wallet/topup/slip")
async def topup_slip(
    body: dict,
    customer: Customer = Depends(get_wallet_customer),
    db: Session = Depends(get_db),
):
    if (_get_setting(db, "topup_slip_enabled") or "on") == "off":
        raise HTTPException(status_code=400, detail="ขณะนี้ปิดรับการเติมเงินผ่านสลีปชั่วคราว กรุณาติดต่อแอดมิน")

    payment_proof = body.get("payment_proof", "")
    amount_hint = body.get("amount_hint")

    if not payment_proof:
        raise HTTPException(status_code=400, detail="กรุณาแนบสลีปโอนเงิน")

    topup = TopupRequest(
        customer_id=customer.id,
        topup_type="slip",
        payment_proof=payment_proof,
        amount=Decimal(str(amount_hint)) if amount_hint else None,
        status="pending",
    )
    db.add(topup)
    db.commit()
    db.refresh(topup)

    mode = _get_setting(db, "slip_verify_mode")
    if mode == "auto" and payment_proof:
        try:
            from backend.slip_verify import verify_slip
            bank_account = _get_setting(db, "bank_account") or None
            bank_code = _get_setting(db, "receiver_bank_code") or None
            result = await verify_slip(
                payment_proof,
                expected_amount=float(amount_hint) if amount_hint else None,
                bank_account=bank_account,
                bank_code=bank_code,
            )
            topup.slip_verify_status = result["status"]
            topup.slip_verify_result = json.dumps(result, ensure_ascii=False, default=str)

            if result["status"] == "verified":
                detected_amount = result.get("amount")
                credit = Decimal(str(detected_amount)) if detected_amount else (
                    Decimal(str(amount_hint)) if amount_hint else None
                )
                if credit and credit > 0:
                    topup.amount = credit
                    topup.status = "approved"
                    customer.balance = (customer.balance or Decimal("0")) + credit
                    db.add(CreditTransaction(
                        customer_id=customer.id,
                        txn_type="topup",
                        amount=credit,
                        description=f"เติมเงินผ่านสลีป (ยืนยันอัตโนมัติ) #{topup.id}",
                        ref_id=topup.id,
                    ))
                    db.commit()
                    return {"ok": True, "auto_approved": True, "balance": float(customer.balance), "topup_id": topup.id}
            db.commit()
        except Exception as e:
            logger.warning(f"Slip auto-verify error for topup #{topup.id}: {e}")
            db.commit()

    try:
        from backend import bot as bot_module
        await bot_module.send_topup_request(
            topup_id=topup.id,
            customer_username=customer.telegram_username,
            amount_hint=amount_hint,
            topup_type="slip",
        )
    except Exception as e:
        logger.warning(f"Topup notify error: {e}")

    return {"ok": True, "auto_approved": False, "topup_id": topup.id, "status": "pending"}


# ── Protected: top-up via TrueMoney ──────────────────────────────────────────

@router.post("/wallet/topup/truemoney")
async def topup_truemoney(
    body: dict,
    customer: Customer = Depends(get_wallet_customer),
    db: Session = Depends(get_db),
):
    if (_get_setting(db, "topup_truemoney_enabled") or "on") == "off":
        raise HTTPException(status_code=400, detail="ขณะนี้ปิดรับการเติมเงินผ่านซองอั่งเปาชั่วคราว กรุณาติดต่อแอดมิน")

    voucher_raw = body.get("voucher", "")

    if not voucher_raw:
        raise HTTPException(status_code=400, detail="กรุณาระบุลิงก์ซอง")

    phone = _get_setting(db, "truemoney_phone") or ""
    if not phone or len(re.sub(r"[^0-9]", "", phone)) < 9:
        raise HTTPException(status_code=400, detail="แอดมินยังไม่ได้ตั้งค่าเบอร์ TrueMoney รับเงิน — กรุณาแจ้งแอดมิน")

    voucher_code = _extract_voucher_code(voucher_raw)

    existing = db.query(TopupRequest).filter(
        TopupRequest.voucher_code == voucher_code,
        TopupRequest.status == "approved",
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="ซองนี้ถูกใช้งานแล้ว")

    topup = TopupRequest(
        customer_id=customer.id,
        topup_type="truemoney",
        voucher_code=voucher_code,
        status="pending",
    )
    db.add(topup)
    db.commit()
    db.refresh(topup)

    auto_mode = _get_setting(db, "truemoney_auto_redeem")
    if auto_mode != "off":
        try:
            phone_clean = re.sub(r"[^0-9]", "", phone)
            url = TRUEMONEY_API.format(code=voucher_code, phone=phone_clean)
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(url)
            data = resp.json()
            logger.info(f"TrueMoney API response for topup #{topup.id}: {data}")
            topup.truemoney_result = json.dumps(data, ensure_ascii=False)

            if str(data.get("code")) == "200" and data.get("status") == "success":
                amount_raw = data.get("data", {}).get("amount", 0)
                credit = Decimal(str(amount_raw))
                topup.amount = credit
                topup.status = "approved"
                customer.balance = (customer.balance or Decimal("0")) + credit
                db.add(CreditTransaction(
                    customer_id=customer.id,
                    txn_type="topup",
                    amount=credit,
                    description=f"เติมเงินซองอั่งเปา TrueMoney {credit:.0f} บาท",
                    ref_id=topup.id,
                ))
                db.commit()
                try:
                    from backend import bot as bot_module
                    await bot_module.send_topup_success(
                        topup_id=topup.id,
                        customer_username=customer.telegram_username,
                        amount=float(credit),
                        topup_type="truemoney",
                        voucher_code=voucher_code,
                    )
                except Exception as notify_err:
                    logger.warning(f"Topup success notify error: {notify_err}")
                return {
                    "ok": True,
                    "auto_approved": True,
                    "amount": float(credit),
                    "balance": float(customer.balance),
                    "topup_id": topup.id,
                }
            else:
                msg_map = {
                    "100": "ซองนี้ถูกใช้งานแล้ว",
                    "101": "ไม่พบซองของขวัญ",
                    "102": "ไม่สามารถใช้ซองของตัวเองได้",
                    "103": "ซองนี้รับไปแล้ว",
                    "104": "ข้อมูลไม่ถูกต้อง",
                    "105": "ซองหมดอายุแล้ว",
                }
                err_code = str(data.get("code", ""))
                err_msg = msg_map.get(err_code, data.get("message", "แลกซองไม่สำเร็จ"))
                topup.status = "pending"
                db.commit()
                try:
                    from backend import bot as bot_module
                    await bot_module.send_topup_request(
                        topup_id=topup.id,
                        customer_username=customer.telegram_username,
                        amount_hint=None,
                        topup_type="truemoney",
                        voucher_code=voucher_code,
                    )
                except Exception as notify_err:
                    logger.warning(f"Topup notify error: {notify_err}")
                return {
                    "ok": True,
                    "auto_approved": False,
                    "topup_id": topup.id,
                    "status": "pending",
                    "message": f"แลกซองอัตโนมัติไม่ได้ ({err_msg}) — ส่งให้แอดมินตรวจสอบแล้ว",
                }

        except HTTPException:
            raise
        except Exception as e:
            logger.warning(f"TrueMoney API error for topup #{topup.id}: {e}")
            topup.status = "pending"
            db.commit()
            try:
                from backend import bot as bot_module
                await bot_module.send_topup_request(
                    topup_id=topup.id,
                    customer_username=customer.telegram_username,
                    amount_hint=None,
                    topup_type="truemoney",
                    voucher_code=voucher_code,
                )
            except Exception as notify_err:
                logger.warning(f"Topup notify error: {notify_err}")
            return {
                "ok": True,
                "auto_approved": False,
                "topup_id": topup.id,
                "status": "pending",
                "message": "ติดต่อ TrueMoney ไม่ได้ชั่วคราว — ส่งให้แอดมินตรวจสอบแล้ว",
            }
    else:
        try:
            from backend import bot as bot_module
            await bot_module.send_topup_request(
                topup_id=topup.id,
                customer_username=customer.telegram_username,
                amount_hint=None,
                topup_type="truemoney",
                voucher_code=voucher_code,
            )
        except Exception as e:
            logger.warning(f"Topup notify error: {e}")
        return {"ok": True, "auto_approved": False, "topup_id": topup.id, "status": "pending"}


# ── Protected: purchase with credits ─────────────────────────────────────────

@router.post("/wallet/purchase")
async def purchase_with_credits(
    body: dict,
    customer: Customer = Depends(get_wallet_customer),
    db: Session = Depends(get_db),
):
    from backend.models import Order, Product
    from backend import bot as bot_module

    product_id = body.get("product_id")
    if not product_id:
        raise HTTPException(status_code=400, detail="กรุณาระบุสินค้า")

    product = db.query(Product).filter(Product.id == product_id, Product.is_active == True).first()
    if not product:
        raise HTTPException(status_code=404, detail="ไม่พบสินค้า")

    price = Decimal(str(product.price))
    if (customer.balance or Decimal("0")) < price:
        raise HTTPException(
            status_code=400,
            detail=f"เครดิตไม่พอ (มี {float(customer.balance or 0):.0f} ต้องการ {float(price):.0f})"
        )

    customer.balance = customer.balance - price
    order = Order(
        telegram_username=customer.telegram_username,
        product_id=product.id,
        product_name=product.name,
        payment_type="credit",
        status="approved",
        link_sent=False,
    )
    db.add(order)
    db.commit()
    db.refresh(order)

    db.add(CreditTransaction(
        customer_id=customer.id,
        txn_type="purchase",
        amount=-price,
        description=f"ซื้อ {product.name}",
        ref_id=order.id,
    ))

    product.sales_count = (product.sales_count or 0) + 1

    # สร้าง FinanceEntry — บันทึกยอดเต็มเข้าระบบ
    from backend.models import FinanceEntry
    db.add(FinanceEntry(
        amount=price,
        description=f"ออเดอร์ #{order.id} — {product.name} (เครดิต)",
        admin_name="ระบบ",
        entry_type="order",
        order_id=order.id,
    ))

    db.commit()

    try:
        invite_links = await bot_module.generate_invite_links(order.id, product.telegram_group_ids or "")
        if invite_links:
            order.invite_links = json.dumps(invite_links)
            order.link_sent = True
            db.commit()
    except Exception as e:
        logger.warning(f"Invite link error for order #{order.id}: {e}")

    return {
        "ok": True,
        "order_id": order.id,
        "balance": float(customer.balance),
        "invite_links": json.loads(order.invite_links) if order.invite_links else [],
    }


# ── My orders (purchases) ─────────────────────────────────────────────────────

@router.get("/wallet/my-orders")
def get_my_orders(
    customer: Customer = Depends(get_wallet_customer),
    db: Session = Depends(get_db),
):
    from backend.models import Order
    orders = (
        db.query(Order)
        .filter(Order.telegram_username == customer.telegram_username)
        .order_by(desc(Order.id))
        .limit(50)
        .all()
    )
    return [
        {
            "id": o.id,
            "product_name": o.product_name,
            "status": o.status,
            "payment_type": o.payment_type,
            "invite_links": json.loads(o.invite_links) if o.invite_links else [],
            "created_at": o.created_at.isoformat() if o.created_at else None,
        }
        for o in orders
    ]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _extract_voucher_code(raw: str) -> str:
    raw = raw.strip()
    match = re.search(r"[?&]v=([A-Za-z0-9]+)", raw)
    if match:
        return match.group(1)
    if re.match(r"^[A-Za-z0-9]+$", raw):
        return raw
    raise HTTPException(status_code=400, detail="รูปแบบลิงก์ซองไม่ถูกต้อง กรุณาวาง link เต็มหรือรหัสซอง")


# ── Admin endpoints ───────────────────────────────────────────────────────────

@router.get("/admin/topup-requests")
def admin_list_topups(
    status: str = Query(default="pending"),
    db: Session = Depends(get_db),
    admin: dict = Depends(get_admin),
):
    q = db.query(TopupRequest)
    if status != "all":
        q = q.filter(TopupRequest.status == status)
    topups = q.order_by(desc(TopupRequest.id)).limit(100).all()
    result = []
    for t in topups:
        cust = db.query(Customer).filter(Customer.id == t.customer_id).first()
        result.append({
            "id": t.id,
            "customer_username": cust.telegram_username if cust else "?",
            "topup_type": t.topup_type,
            "amount": float(t.amount) if t.amount else None,
            "status": t.status,
            "slip_verify_status": t.slip_verify_status,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        })
    return result


@router.post("/admin/topup-requests/{topup_id}/approve")
def admin_approve_topup(
    topup_id: int,
    body: dict,
    db: Session = Depends(get_db),
    admin: dict = Depends(get_admin),
):
    topup = db.query(TopupRequest).filter(TopupRequest.id == topup_id).first()
    if not topup:
        raise HTTPException(status_code=404, detail="ไม่พบรายการ")
    if topup.status != "pending":
        raise HTTPException(status_code=400, detail="รายการนี้ดำเนินการแล้ว")

    amount = Decimal(str(body.get("amount", topup.amount or 0)))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="กรุณาระบุจำนวนเครดิต")

    customer = db.query(Customer).filter(Customer.id == topup.customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="ไม่พบบัญชีลูกค้า")

    topup.amount = amount
    topup.status = "approved"
    customer.balance = (customer.balance or Decimal("0")) + amount
    db.add(CreditTransaction(
        customer_id=customer.id,
        txn_type="topup",
        amount=amount,
        description=f"แอดมินอนุมัติเติมเงิน #{topup_id} ({topup.topup_type})",
        ref_id=topup_id,
    ))
    db.commit()
    return {"ok": True, "balance": float(customer.balance)}


@router.post("/admin/topup-requests/{topup_id}/reject")
def admin_reject_topup(
    topup_id: int,
    db: Session = Depends(get_db),
    admin: dict = Depends(get_admin),
):
    topup = db.query(TopupRequest).filter(TopupRequest.id == topup_id).first()
    if not topup:
        raise HTTPException(status_code=404, detail="ไม่พบรายการ")
    topup.status = "rejected"
    db.commit()
    return {"ok": True}


@router.get("/admin/customers")
def admin_list_customers(
    db: Session = Depends(get_db),
    admin: dict = Depends(get_admin),
):
    customers = db.query(Customer).order_by(desc(Customer.id)).limit(200).all()
    result = []
    for c in customers:
        txn_count = db.query(CreditTransaction).filter(CreditTransaction.customer_id == c.id).count()
        result.append({
            "id": c.id,
            "telegram_username": c.telegram_username,
            "balance": float(c.balance or 0),
            "transaction_count": txn_count,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        })
    return result


@router.post("/admin/customers/{customer_id}/adjust")
def admin_adjust_balance(
    customer_id: int,
    body: dict,
    db: Session = Depends(get_db),
    admin: dict = Depends(get_admin),
):
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="ไม่พบลูกค้า")
    amount = Decimal(str(body.get("amount", 0)))
    reason = body.get("reason", "แอดมินปรับยอด")
    customer.balance = (customer.balance or Decimal("0")) + amount
    db.add(CreditTransaction(
        customer_id=customer.id,
        txn_type="adjustment",
        amount=amount,
        description=f"[แอดมิน] {reason}",
        ref_id=None,
    ))
    db.commit()
    return {"ok": True, "balance": float(customer.balance)}
