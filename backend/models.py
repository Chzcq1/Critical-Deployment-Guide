from sqlalchemy import Column, Integer, String, Text, Numeric, DateTime, Boolean, BigInteger, ForeignKey
from sqlalchemy.sql import func
from backend.database import Base


class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    price = Column(Numeric(10, 2), nullable=False)
    fake_discount_price = Column(Numeric(10, 2), nullable=True)
    image_url = Column(String(500), nullable=True)
    image_urls = Column(Text, nullable=True)
    telegram_group_ids = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    sort_order = Column(Integer, default=0, nullable=False, server_default="0")
    is_featured = Column(Boolean, default=False, nullable=False, server_default="false")
    badge_text = Column(String(50), nullable=True)
    badge_color = Column(String(20), nullable=True)
    sales_count = Column(Integer, default=0, nullable=False, server_default="0")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True)
    telegram_user_id = Column(BigInteger, nullable=True, index=True)
    telegram_username = Column(String(255), nullable=True)
    telegram_first_name = Column(String(255), nullable=True)
    product_id = Column(Integer, nullable=False)
    product_name = Column(String(255), nullable=False)
    payment_proof = Column(Text, nullable=True)
    payment_type = Column(String(50), nullable=False, default="slip")
    status = Column(String(50), nullable=False, default="pending")
    admin_message_id = Column(BigInteger, nullable=True)
    link_sent = Column(Boolean, default=False, nullable=False)
    invite_links = Column(Text, nullable=True)
    phone_number = Column(String(20), nullable=True)
    slip_verify_status = Column(String(20), nullable=True)
    slip_verify_result = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class OTPSession(Base):
    __tablename__ = "otp_sessions"

    id = Column(Integer, primary_key=True, index=True)
    telegram_id = Column(BigInteger, nullable=False)
    otp_code = Column(String(8), nullable=False)
    is_used = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=False)


class StoreSettings(Base):
    __tablename__ = "store_settings"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(100), unique=True, nullable=False)
    value = Column(Text, nullable=True)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class Announcement(Base):
    __tablename__ = "announcements"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    content = Column(Text, nullable=True)
    images = Column(Text, nullable=True)
    font_size = Column(String(10), nullable=False, default="base")
    is_active = Column(Boolean, default=True, nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class FinanceEntry(Base):
    __tablename__ = "finance_entries"

    id = Column(Integer, primary_key=True, index=True)
    amount = Column(Numeric(10, 2), nullable=False)
    description = Column(String(255), nullable=False)
    admin_name = Column(String(100), nullable=False)
    entry_type = Column(String(50), nullable=False, default="income")
    order_id = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AdminLog(Base):
    __tablename__ = "admin_logs"

    id = Column(Integer, primary_key=True, index=True)
    admin_name = Column(String(100), nullable=False)
    action = Column(String(100), nullable=False)
    details = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Customer(Base):
    __tablename__ = "customers"

    id = Column(Integer, primary_key=True, index=True)
    telegram_username = Column(String(255), unique=True, nullable=False, index=True)
    balance = Column(Numeric(12, 2), nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class TopupRequest(Base):
    __tablename__ = "topup_requests"

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False, index=True)
    topup_type = Column(String(20), nullable=False, default="slip")
    amount = Column(Numeric(12, 2), nullable=True)
    payment_proof = Column(Text, nullable=True)
    voucher_code = Column(String(100), nullable=True, unique=True)
    status = Column(String(20), nullable=False, default="pending")
    slip_verify_status = Column(String(30), nullable=True)
    slip_verify_result = Column(Text, nullable=True)
    truemoney_result = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class CreditTransaction(Base):
    __tablename__ = "credit_transactions"

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False, index=True)
    txn_type = Column(String(20), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    description = Column(String(300), nullable=True)
    ref_id = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
