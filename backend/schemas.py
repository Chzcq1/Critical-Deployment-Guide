from pydantic import BaseModel, field_validator
from typing import Optional
from decimal import Decimal
from datetime import datetime


class ProductBase(BaseModel):
    name: str
    description: Optional[str] = None
    price: Decimal
    fake_discount_price: Optional[Decimal] = None
    image_url: Optional[str] = None
    telegram_group_ids: Optional[str] = None
    is_active: bool = True


class ProductCreate(ProductBase):
    pass


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    price: Optional[Decimal] = None
    fake_discount_price: Optional[Decimal] = None
    image_url: Optional[str] = None
    telegram_group_ids: Optional[str] = None
    is_active: Optional[bool] = None


class ProductResponse(ProductBase):
    id: int
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class TelegramUser(BaseModel):
    id: int
    first_name: str
    last_name: Optional[str] = None
    username: Optional[str] = None
    photo_url: Optional[str] = None
    auth_date: int
    hash: str


class OrderSubmit(BaseModel):
    telegram_user_id: Optional[int] = None
    telegram_username: Optional[str] = None
    telegram_first_name: Optional[str] = None
    product_id: int
    payment_proof: str
    payment_type: str = "slip"


class OrderResponse(BaseModel):
    id: int
    telegram_user_id: Optional[int] = None
    telegram_username: Optional[str] = None
    telegram_first_name: Optional[str] = None
    product_id: int
    product_name: str
    payment_type: str
    payment_proof: Optional[str] = None
    status: str
    link_sent: bool = False
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class OTPRequest(BaseModel):
    telegram_id: int


class OTPVerify(BaseModel):
    telegram_id: int
    otp_code: str


class AdminToken(BaseModel):
    access_token: str
    token_type: str = "bearer"


class OrderStatusResponse(BaseModel):
    id: int
    product_name: str
    payment_type: str
    status: str
    link_sent: bool
    invite_links: Optional[str] = None
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class StoreSettingsUpdate(BaseModel):
    hero_title: Optional[str] = None
    hero_subtitle: Optional[str] = None
    announcement: Optional[str] = None
    store_name: Optional[str] = None
    bot_username: Optional[str] = None


class StoreSettingsResponse(BaseModel):
    hero_title: str
    hero_subtitle: str
    announcement: str
    store_name: str
    bot_username: str
