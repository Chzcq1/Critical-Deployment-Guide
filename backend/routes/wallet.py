import json
import logging
import re
import httpx
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from backend.database import get_db
from backend.models import Customer, TopupRequest, CreditTransaction, StoreSettings
from backend.routes.admin import get_admin, _get_setting

logger = logging.getLogger(__name__)
router = APIRouter()

TRUEMONEY_API = "https://gateway.autozy.app/api/giftvoucher/{code}/{phone}/"


def _get_or_create_customer(db: Session, username: str) -> Customer:
    uname = username.lstrip("@").strip().lower()
    if not uname:
        raise HTTPException(status_code=400, detail="กรุณาระบุ Telegram Username")
    customer = db.query(Customer).filter(Customer.telegram_username == uname).first()
    if not customer:
        customer = Customer(telegram_username=uname, balance=Decimal("0.00"))
        db.add(customer)
        db.commit()
        db.refresh(customer)
    return customer


def _extract_voucher_code(raw: str) -> str:
    raw = raw.strip()
    match = re.search(r"[?&]v=([A-Za-z0-9]+)", raw)
    if match:
        return match.group(1)
    if re.match(r"^[A-Za-z0-9]+$", raw):
        return raw
    raise HTTPException(status_code=400, detail="รูปแบบลิงก์ซองไม่ถูกต้อง กรุณาวาง link เต็มหรือรหัสซอง")


@router.get("/wallet/{username}")
def get_wallet(username: str, db: Session = Depends(get_db)):
    customer = _get_or_create_customer(db, username)
    txns = (
        db.query(CreditTransaction)
        .filter(CreditTransaction.customer_id == customer.id)
        .order_by(desc(CreditTransaction.id))
        .limit(30)
        .all()
    )
    return {
        "username": customer.telegram_username,
        "balance": float(customer.balance),
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


@router.post("/wallet/topup/slip")
async def topup_slip(
    body: dict,
    db: Session = Depends(get_db),
):
    username = body.get("username", "")
    payment_proof = body.get("payment_proof", "")
    amount_hint = body.get("amount_hint")

    if not username or not payment_proof:
        raise HTTPException(status_code=400, detail="กรุณาระบุ username และสลีปโอนเงิน")

    customer = _get_or_create_customer(db, username)

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
                credit = Decimal(str(detected_amount)) if detected_amount else (Decimal(str(amount_hint)) if amount_hint else None)
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


@router.post("/wallet/topup/truemoney")
async def topup_truemoney(body: dict, db: Session = Depends(get_db)):
    username = body.get("username", "")
    voucher_raw = body.get("voucher", "")
    phone = body.get("phone", "")

    if not username or not voucher_raw:
        raise HTTPException(status_code=400, detail="กรุณาระบุ username และลิงก์ซอง")
    if not phone or len(phone.replace("-", "").replace(" ", "")) < 9:
        raise HTTPException(status_code=400, detail="กรุณาระบุเบอร์โทรที่ผูกกับ TrueMoney Wallet")

    voucher_code = _extract_voucher_code(voucher_raw)
    customer = _get_or_create_customer(db, username)

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
                return {
                    "ok": True,
                    "auto_approved": True,
                    "amount": float(credit),
                    "balance": float(customer.balance),
                    "topup_id": topup.id,
                    "message": data.get("message", ""),
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
                topup.status = "rejected"
                topup.truemoney_result = json.dumps(data, ensure_ascii=False)
                db.commit()
                raise HTTPException(status_code=400, detail=err_msg)

        except HTTPException:
            raise
        except Exception as e:
            logger.warning(f"TrueMoney API error for topup #{topup.id}: {e}")
            topup.status = "rejected"
            db.commit()
            raise HTTPException(status_code=500, detail="ไม่สามารถติดต่อ TrueMoney API ได้ กรุณาลองใหม่")
    else:
        try:
            from backend import bot as bot_module
            await bot_module.send_topup_request(
                topup_id=topup.id,
                customer_username=customer.telegram_username,
                amount_hint=None,
                topup_type="truemoney",
            )
        except Exception as e:
            logger.warning(f"Topup notify error: {e}")
        return {"ok": True, "auto_approved": False, "topup_id": topup.id, "status": "pending"}


@router.post("/wallet/purchase")
async def purchase_with_credits(body: dict, db: Session = Depends(get_db)):
    from backend.models import Order, Product
    from backend import bot as bot_module

    username = body.get("username", "")
    product_id = body.get("product_id")

    if not username or not product_id:
        raise HTTPException(status_code=400, detail="กรุณาระบุ username และสินค้า")

    customer = _get_or_create_customer(db, username)
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


# ── Admin endpoints ──────────────────────────────────────────────────────────

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
