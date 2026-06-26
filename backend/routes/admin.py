import os
from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional, Dict
from datetime import datetime, timedelta
from backend.database import get_db
from backend.models import Product, Order, OTPSession, StoreSettings
from backend.schemas import (
    ProductCreate, ProductUpdate, ProductResponse,
    OrderResponse, OTPRequest, OTPVerify, AdminToken,
    StoreSettingsUpdate, StoreSettingsResponse,
)
from backend.auth import generate_otp, create_admin_token, verify_admin_token
from backend import bot as bot_module

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
    if body.passcode != settings.secret_key:
        raise HTTPException(status_code=403, detail="รหัสผ่านไม่ถูกต้อง")

    otp = generate_otp()
    expires = datetime.utcnow() + timedelta(minutes=5)
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
    session = (
        db.query(OTPSession)
        .filter(
            OTPSession.telegram_id == ADMIN_SESSION_ID,
            OTPSession.otp_code == body.otp_code,
            OTPSession.is_used == False,
            OTPSession.expires_at > datetime.utcnow(),
        )
        .order_by(OTPSession.created_at.desc())
        .first()
    )
    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired OTP")

    session.is_used = True
    db.commit()

    token = create_admin_token(body.telegram_id)
    return AdminToken(access_token=token)


@router.get("/admin/products", response_model=List[ProductResponse])
def admin_list_products(db: Session = Depends(get_db), admin: dict = Depends(get_admin)):
    return db.query(Product).order_by(Product.id.desc()).all()


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


@router.get("/admin/orders", response_model=List[OrderResponse])
def list_orders(db: Session = Depends(get_db), admin: dict = Depends(get_admin)):
    return db.query(Order).order_by(Order.id.desc()).all()


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
