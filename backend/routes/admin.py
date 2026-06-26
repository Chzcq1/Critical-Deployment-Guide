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


@router.post("/admin/request-otp")
async def request_otp(body: OTPRequest, db: Session = Depends(get_db)):
    otp = generate_otp()
    expires = datetime.utcnow() + timedelta(minutes=5)
    session = OTPSession(
        telegram_id=body.telegram_id,
        otp_code=otp,
        expires_at=expires,
    )
    db.add(session)
    db.commit()

    sent = await bot_module.send_otp(body.telegram_id, otp)
    if not sent:
        raise HTTPException(status_code=500, detail="Failed to send OTP. Check bot configuration.")

    return {"message": "OTP sent to admin group chat"}


@router.post("/admin/verify-otp", response_model=AdminToken)
def verify_otp(body: OTPVerify, db: Session = Depends(get_db)):
    session = (
        db.query(OTPSession)
        .filter(
            OTPSession.telegram_id == body.telegram_id,
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


@router.get("/store-settings", response_model=StoreSettingsResponse)
def get_store_settings(db: Session = Depends(get_db)):
    return StoreSettingsResponse(
        hero_title=_get_setting(db, "hero_title"),
        hero_subtitle=_get_setting(db, "hero_subtitle"),
        announcement=_get_setting(db, "announcement"),
        store_name=_get_setting(db, "store_name"),
    )


@router.put("/admin/store-settings", response_model=StoreSettingsResponse)
def update_store_settings(body: StoreSettingsUpdate, db: Session = Depends(get_db), admin: dict = Depends(get_admin)):
    updates = body.model_dump(exclude_none=True)
    for key, value in updates.items():
        _set_setting(db, key, value)
    db.commit()
    return StoreSettingsResponse(
        hero_title=_get_setting(db, "hero_title"),
        hero_subtitle=_get_setting(db, "hero_subtitle"),
        announcement=_get_setting(db, "announcement"),
        store_name=_get_setting(db, "store_name"),
    )
