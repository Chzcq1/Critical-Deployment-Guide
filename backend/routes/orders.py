import json
import logging
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import Order, Product, StoreSettings, FinanceEntry
from backend.schemas import OrderSubmit, OrderResponse, OrderStatusResponse, OrderLinksUpdate
from backend import bot as bot_module
from backend.routes.admin import get_admin, _get_setting

logger = logging.getLogger(__name__)

router = APIRouter()


async def _send_to_admin(order_id: int, product_name: str, order: Order):
    message_id = await bot_module.send_approval_request(
        order_id=order_id,
        product_name=product_name,
        customer_id=order.telegram_user_id or 0,
        customer_username=order.telegram_username,
        customer_first_name=order.telegram_first_name,
        payment_proof=order.payment_proof,
        payment_type=order.payment_type,
    )
    return message_id


async def _run_auto_approve(order: Order, product: Product | None, db: Session, verify_result: dict) -> None:
    """Run the full approve flow after successful auto-verification."""
    order.status = "approved"
    db.commit()

    # Generate Telegram invite links
    group_ids_str = (product.telegram_group_ids or "") if product else ""
    if group_ids_str:
        try:
            invite_links = await bot_module.generate_invite_links(order.id, group_ids_str)
            if invite_links:
                order.invite_links = json.dumps(invite_links)
                order.link_sent = True
                db.commit()
        except Exception as e:
            logger.warning(f"invite link error for order #{order.id}: {e}")

    # Increment sales count
    if product:
        product.sales_count = (product.sales_count or 0) + 1
        db.commit()

    # Finance entries
    if product:
        price = Decimal(str(product.price))
        db.add(FinanceEntry(
            amount=price,
            description=f"ออเดอร์ #{order.id} — {product.name} [ยืนยันสลีปอัตโนมัติ]",
            admin_name="ระบบ",
            entry_type="order",
            order_id=order.id,
        ))
        db.commit()

        # Notify admin group
        try:
            amount = verify_result.get("amount")
            await bot_module.send_finance_notification(
                action="✅ ยืนยันอัตโนมัติ (Slip2Go)",
                description=(
                    f"ออเดอร์ #{order.id} — {product.name}\n"
                    f"ลูกค้า: {order.telegram_first_name or order.telegram_username or 'ไม่ระบุ'}\n"
                    f"ยอด: {amount} บาท (API ยืนยันแล้ว)"
                ),
                amount=float(price),
                admin_name="ระบบ",
            )
        except Exception as e:
            logger.warning(f"finance notify error: {e}")

    logger.info(f"Order #{order.id} auto-approved via Slip2Go")


@router.post("/orders", response_model=OrderResponse)
async def submit_order(payload: OrderSubmit, db: Session = Depends(get_db)):
    product = db.query(Product).filter(Product.id == payload.product_id, Product.is_active == True).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    order = Order(
        telegram_user_id=payload.telegram_user_id or None,
        telegram_username=payload.telegram_username,
        telegram_first_name=payload.telegram_first_name,
        phone_number=payload.phone_number or None,
        product_id=payload.product_id,
        product_name=product.name,
        payment_proof=payload.payment_proof,
        payment_type=payload.payment_type,
        status="pending",
        link_sent=False,
    )
    db.add(order)
    db.commit()
    db.refresh(order)

    # Determine mode
    mode_row = db.query(StoreSettings).filter(StoreSettings.key == "slip_verify_mode").first()
    mode = (mode_row.value if mode_row else None) or "off"

    if payload.payment_type == "slip" and payload.payment_proof and mode == "auto":
        # ── AUTO MODE: verify first, then decide ──────────────────────────────
        try:
            from backend.slip_verify import verify_slip
            expected_amount = float(product.price) if product.price is not None else None
            bank_account = _get_setting(db, "bank_account") or None
            bank_code = _get_setting(db, "receiver_bank_code") or None

            result = await verify_slip(
                payload.payment_proof,
                expected_amount=expected_amount,
                bank_account=bank_account,
                bank_code=bank_code,
            )
            order.slip_verify_status = result["status"]
            order.slip_verify_result = json.dumps(result, ensure_ascii=False, default=str)
            db.commit()

            if result["status"] == "verified":
                # ✅ Slip OK → auto-approve, no Telegram manual review needed
                await _run_auto_approve(order, product, db, result)
            else:
                # ❌ Slip failed → send to admin for manual review (with verify badge shown)
                logger.info(f"Order #{order.id} verify failed ({result['status']}), sending to admin")
                try:
                    message_id = await _send_to_admin(order.id, product.name, order)
                    if message_id:
                        order.admin_message_id = message_id
                        db.commit()
                except Exception as e:
                    logger.warning(f"send_to_admin error: {e}")

        except Exception as e:
            logger.warning(f"Auto-verify exception for order #{order.id}: {e}")
            db.commit()
            # Fall back to manual review
            try:
                message_id = await _send_to_admin(order.id, product.name, order)
                if message_id:
                    order.admin_message_id = message_id
                    db.commit()
            except Exception:
                pass

    else:
        # ── MANUAL / OFF: always send to admin for review ─────────────────────
        try:
            message_id = await _send_to_admin(order.id, product.name, order)
            if message_id:
                order.admin_message_id = message_id
                db.commit()
        except Exception:
            pass

    db.refresh(order)
    return order


@router.get("/orders/by-phone", response_model=list[OrderStatusResponse])
def lookup_by_phone(
    phone: str = Query(..., description="Phone number"),
    db: Session = Depends(get_db),
):
    phone_clean = phone.strip().replace("-", "").replace(" ", "")
    if len(phone_clean) < 9:
        raise HTTPException(status_code=400, detail="กรุณากรอกเบอร์โทรให้ครบ")
    orders = (
        db.query(Order)
        .filter(Order.phone_number.ilike(f"%{phone_clean}%"))
        .order_by(Order.id.desc())
        .limit(10)
        .all()
    )
    return orders


@router.get("/orders/{order_id}/status", response_model=OrderStatusResponse)
def get_order_status(
    order_id: int,
    name: str = Query(default=""),
    phone: str = Query(default=""),
    db: Session = Depends(get_db),
):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="ไม่พบออเดอร์นี้")

    name_clean = (name or "").strip().lower()
    phone_clean = (phone or "").strip().replace("-", "").replace(" ", "")
    stored_name = (order.telegram_first_name or "").strip().lower()
    stored_phone = (order.phone_number or "").strip().replace("-", "").replace(" ", "")

    if not name_clean and not phone_clean:
        raise HTTPException(status_code=400, detail="กรุณากรอกชื่อหรือเบอร์โทรเพื่อยืนยัน")

    verified = False
    if name_clean and name_clean == stored_name:
        verified = True
    if phone_clean and stored_phone and phone_clean == stored_phone:
        verified = True

    if not verified:
        raise HTTPException(status_code=403, detail="ชื่อหรือเบอร์โทรไม่ตรงกับออเดอร์นี้")

    return order


@router.put("/admin/orders/{order_id}/links")
def admin_set_links(
    order_id: int,
    body: OrderLinksUpdate,
    db: Session = Depends(get_db),
    admin: dict = Depends(get_admin),
):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    order.invite_links = json.dumps(body.invite_links)
    order.link_sent = True
    if order.status != "approved":
        order.status = "approved"
    db.commit()
    return {"ok": True, "invite_links": body.invite_links}
