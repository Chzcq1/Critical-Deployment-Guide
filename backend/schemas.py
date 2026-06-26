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
    image_urls: Optional[str] = None
    telegram_group_ids: Optional[str] = None
    is_active: bool = True
    is_featured: bool = False
    badge_text: Optional[str] = None
    badge_color: Optional[str] = None
    sales_count: int = 0


class ProductCreate(ProductBase):
    pass


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    price: Optional[Decimal] = None
    fake_discount_price: Optional[Decimal] = None
    image_url: Optional[str] = None
    image_urls: Optional[str] = None
    telegram_group_ids: Optional[str] = None
    is_active: Optional[bool] = None
    is_featured: Optional[bool] = None
    badge_text: Optional[str] = None
    badge_color: Optional[str] = None
    sales_count: Optional[int] = None
    sort_order: Optional[int] = None


class ProductResponse(ProductBase):
    id: int
    sort_order: int = 0
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
    phone_number: Optional[str] = None
    product_id: int
    payment_proof: str
    payment_type: str = "slip"


class OrderResponse(BaseModel):
    id: int
    telegram_user_id: Optional[int] = None
    telegram_username: Optional[str] = None
    telegram_first_name: Optional[str] = None
    phone_number: Optional[str] = None
    product_id: int
    product_name: str
    payment_type: str
    payment_proof: Optional[str] = None
    status: str
    link_sent: bool = False
    slip_verify_status: Optional[str] = None
    slip_verify_result: Optional[str] = None
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class OrderLinksUpdate(BaseModel):
    invite_links: list[str]


class OTPRequest(BaseModel):
    passcode: str


class OTPVerify(BaseModel):
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
    bank_name: Optional[str] = None
    bank_account: Optional[str] = None
    bank_qr_url: Optional[str] = None
    finance_admin_names: Optional[str] = None
    slip_verify_mode: Optional[str] = None


class StoreSettingsResponse(BaseModel):
    hero_title: str
    hero_subtitle: str
    announcement: str
    store_name: str
    bot_username: str
    bank_name: str
    bank_account: str
    bank_qr_url: str
    finance_admin_names: str
    slip_verify_mode: str


class AdminLogCreate(BaseModel):
    admin_name: str
    action: str
    details: Optional[str] = None


class AdminLogResponse(BaseModel):
    id: int
    admin_name: str
    action: str
    details: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class FinanceEntryCreate(BaseModel):
    amount: Decimal
    description: str
    admin_name: str
    entry_type: str = "income"


class FinanceEntryResponse(BaseModel):
    id: int
    amount: Decimal
    description: str
    admin_name: str
    entry_type: str
    order_id: Optional[int] = None
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class FinanceSummary(BaseModel):
    total_balance: Decimal
    admin_balances: dict
    daily_chart: list
    monthly_goal: Decimal


class AnnouncementCreate(BaseModel):
    title: str
    content: Optional[str] = None
    images: Optional[str] = None
    font_size: str = "base"
    is_active: bool = True


class AnnouncementUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    images: Optional[str] = None
    font_size: Optional[str] = None
    is_active: Optional[bool] = None


class AnnouncementResponse(BaseModel):
    id: int
    title: str
    content: Optional[str] = None
    images: Optional[str] = None
    font_size: str
    is_active: bool
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}
