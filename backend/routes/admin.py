import os
import json
from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional, Dict
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from backend.database import get_db
from backend.models import Product, Order, OTPSession, StoreSettings, FinanceEntry, AdminLog
from backend.schemas import (
    ProductCreate, ProductUpdate, ProductResponse,
    OrderResponse, OTPRequest, OTPVerify, AdminToken,
    StoreSettingsUpdate, StoreSettingsResponse,
    AdminLogCreate, AdminLogResponse,
)
from backend.auth import generate_otp, create_admin_token, verify_admin_token
from backend import bot as bot_module
from backend.config import get_settings

settings = get_settings()

router = APIRouter()

SETTING_DEFAULTS = {
    "hero_title": "สินค้าดิจิทัลพรีเมียม",
    "hero_subtitle": "รับสิทธิ์ทันทีผ่าน Telegram — ชำระเงิน รอยืนยัน รับลิงก์",
    "announcement": "",
    "store_name": "DigitalStore",
    "bot_username": "",
    "bank_name": "",
    "bank_account": "",
    "bank_qr_url": "",
    "finance_admin_names": "",
    "finance_monthly_goal": "0",
    "slip_verify_mode": "off",
}


def get_admin(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1]
    payload = verify_admin_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return payload


def _get_setting(db: Session, key: str) -> str:
    row = db.query(StoreSettings).filter(StoreSettings.key == key).first()
    return row.value if (row and row.value is not None) else SETTING_DEFAULTS.get(key, "")


def _set_setting(db: Session, key: str, value: str):
    row = db.query(StoreSettings).filter(StoreSettings.key == key).first()
    if row:
        row.value = value
    else:
        row = StoreSettings(key=key, value=value)
        db.add(row)


ADMIN_SESSION_ID = 0  # fixed placeholder — no Telegram ID needed


@router.post("/admin/request-otp")
async def request_otp(body: OTPRequest, db: Session = Depends(get_db)):
    expected = settings.admin_passcode or settings.secret_key
    if body.passcode != expected:
        raise HTTPException(status_code=403, detail="รหัสผ่านไม่ถูกต้อง")

    otp = generate_otp()
    expires = datetime.now(timezone.utc) + timedelta(minutes=5)
    session = OTPSession(
        telegram_id=ADMIN_SESSION_ID,
        otp_code=otp,
        expires_at=expires,
    )
    db.add(session)
    db.commit()

    sent, err_msg = await bot_module.send_otp(ADMIN_SESSION_ID, otp)
    if not sent:
        raise HTTPException(status_code=500, detail=f"ส่ง OTP ไม่สำเร็จ: {err_msg}")

    return {"message": "OTP sent to admin group chat"}


@router.post("/admin/verify-otp", response_model=AdminToken)
def verify_otp(body: OTPVerify, db: Session = Depends(get_db)):
    otp_input = (body.otp_code or "").strip()
    session = (
        db.query(OTPSession)
        .filter(
            OTPSession.telegram_id == ADMIN_SESSION_ID,
            OTPSession.otp_code == otp_input,
            OTPSession.is_used == False,
            OTPSession.expires_at > datetime.now(timezone.utc),
        )
        .order_by(OTPSession.created_at.desc())
        .first()
    )
    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired OTP")

    session.is_used = True
    db.commit()

    token = create_admin_token(ADMIN_SESSION_ID)
    return AdminToken(access_token=token)


@router.get("/admin/products", response_model=List[ProductResponse])
def admin_list_products(db: Session = Depends(get_db), admin: dict = Depends(get_admin)):
    return db.query(Product).order_by(Product.sort_order.asc(), Product.id.asc()).all()


@router.post("/admin/products", response_model=ProductResponse, status_code=201)
def create_product(body: ProductCreate, db: Session = Depends(get_db), admin: dict = Depends(get_admin)):
    product = Product(**body.model_dump())
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


@router.put("/admin/products/{product_id}", response_model=ProductResponse)
def update_product(product_id: int, body: ProductUpdate, db: Session = Depends(get_db), admin: dict = Depends(get_admin)):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    for key, val in body.model_dump(exclude_unset=True).items():
        setattr(product, key, val)
    db.commit()
    db.refresh(product)
    return product


@router.delete("/admin/products/{product_id}")
def delete_product(product_id: int, db: Session = Depends(get_db), admin: dict = Depends(get_admin)):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    db.delete(product)
    db.commit()
    return {"message": "Product deleted"}


@router.post("/admin/products/{product_id}/move")
def move_product(product_id: int, direction: str, db: Session = Depends(get_db), admin: dict = Depends(get_admin)):
    products = db.query(Product).order_by(Product.sort_order.asc(), Product.id.asc()).all()
    idx = next((i for i, p in enumerate(products) if p.id == product_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Product not found")

    if direction == "up" and idx > 0:
        swap_idx = idx - 1
    elif direction == "down" and idx < len(products) - 1:
        swap_idx = idx + 1
    else:
        return {"ok": True}

    a, b = products[idx], products[swap_idx]
    a.sort_order, b.sort_order = swap_idx, idx
    db.commit()
    return {"ok": True}


@router.get("/admin/orders", response_model=List[OrderResponse])
def list_orders(db: Session = Depends(get_db), admin: dict = Depends(get_admin)):
    return db.query(Order).order_by(Order.id.desc()).all()


@router.delete("/admin/orders/{order_id}")
def delete_order(order_id: int, db: Session = Depends(get_db), admin: dict = Depends(get_admin)):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    db.delete(order)
    db.commit()
    return {"message": "Order deleted"}


@router.post("/admin/orders/{order_id}/approve", response_model=OrderResponse)
async def admin_approve_order(order_id: int, db: Session = Depends(get_db), admin: dict = Depends(get_admin)):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status != "pending":
        raise HTTPException(status_code=400, detail=f"ออเดอร์นี้มีสถานะ '{order.status}' แล้ว")

    order.status = "approved"
    db.commit()

    product = db.query(Product).filter(Product.id == order.product_id).first()
    group_ids_str = (product.telegram_group_ids or "") if product else ""

    if group_ids_str:
        try:
            invite_links = await bot_module.generate_invite_links(order.id, group_ids_str)
            if invite_links:
                order.invite_links = json.dumps(invite_links)
                order.link_sent = True
                db.commit()
        except Exception:
            pass

    if product:
        product.sales_count = (product.sales_count or 0) + 1
        db.commit()

    # Auto-add finance entry for approved order
    if product:
        price = Decimal(str(product.price))
        admin_names_str = _get_setting(db, "finance_admin_names")
        admin_names = [n.strip() for n in admin_names_str.split(",") if n.strip()] if admin_names_str else ["แอดมิน"]
        per_admin = price / len(admin_names)
        for name in admin_names:
            entry = FinanceEntry(
                amount=per_admin,
                description=f"ออเดอร์ #{order.id} — {product.name}",
                admin_name=name,
                entry_type="order",
                order_id=order.id,
            )
            db.add(entry)
        db.commit()
        try:
            await bot_module.send_finance_notification(
                action="รายได้จากออเดอร์",
                description=f"ออเดอร์ #{order.id} — {product.name}",
                amount=float(price),
                admin_name=" / ".join(admin_names),
            )
        except Exception:
            pass

    db.refresh(order)
    return order


@router.post("/admin/orders/{order_id}/verify-slip", response_model=OrderResponse)
async def admin_verify_slip(order_id: int, db: Session = Depends(get_db), admin: dict = Depends(get_admin)):
    """Manually (re-)verify a bank slip for an order using SlipOK API."""
    import json as _json
    from backend.slip_verify import verify_slip

    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.payment_type != "slip" or not order.payment_proof:
        raise HTTPException(status_code=400, detail="ออเดอร์นี้ไม่มีสลีปให้ตรวจ")

    result = await verify_slip(order.payment_proof)
    order.slip_verify_status = result["status"]
    order.slip_verify_result = _json.dumps(result, ensure_ascii=False, default=str)
    db.commit()
    db.refresh(order)
    return order


@router.post("/admin/orders/{order_id}/reject", response_model=OrderResponse)
def admin_reject_order(order_id: int, db: Session = Depends(get_db), admin: dict = Depends(get_admin)):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status != "pending":
        raise HTTPException(status_code=400, detail=f"ออเดอร์นี้มีสถานะ '{order.status}' แล้ว")

    order.status = "rejected"
    db.commit()
    db.refresh(order)
    return order


def _build_settings_response(db: Session) -> StoreSettingsResponse:
    bot_username = _get_setting(db, "bot_username") or os.environ.get("BOT_USERNAME", "")
    return StoreSettingsResponse(
        hero_title=_get_setting(db, "hero_title"),
        hero_subtitle=_get_setting(db, "hero_subtitle"),
        announcement=_get_setting(db, "announcement"),
        store_name=_get_setting(db, "store_name"),
        bot_username=bot_username,
        bank_name=_get_setting(db, "bank_name"),
        bank_account=_get_setting(db, "bank_account"),
        bank_qr_url=_get_setting(db, "bank_qr_url"),
        finance_admin_names=_get_setting(db, "finance_admin_names"),
        slip_verify_mode=_get_setting(db, "slip_verify_mode") or "off",
    )


@router.get("/store-settings", response_model=StoreSettingsResponse)
def get_store_settings(db: Session = Depends(get_db)):
    return _build_settings_response(db)


@router.put("/admin/store-settings", response_model=StoreSettingsResponse)
def update_store_settings(body: StoreSettingsUpdate, db: Session = Depends(get_db), admin: dict = Depends(get_admin)):
    for key, value in body.model_dump(exclude_none=True).items():
        _set_setting(db, key, value)
    db.commit()
    return _build_settings_response(db)


@router.get("/admin/logs", response_model=List[AdminLogResponse])
def get_admin_logs(limit: int = 50, db: Session = Depends(get_db), _: dict = Depends(get_admin)):
    return db.query(AdminLog).order_by(AdminLog.id.desc()).limit(limit).all()


@router.post("/admin/logs", response_model=AdminLogResponse, status_code=201)
def create_admin_log(body: AdminLogCreate, db: Session = Depends(get_db), _: dict = Depends(get_admin)):
    log = AdminLog(admin_name=body.admin_name, action=body.action, details=body.details)
    db.add(log)
    db.commit()
    db.refresh(log)
    return log
