import asyncio
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models import Order, Product
from backend.schemas import OrderSubmit, OrderResponse
from backend import bot as bot_module

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


@router.post("/orders", response_model=OrderResponse)
async def submit_order(payload: OrderSubmit, db: Session = Depends(get_db)):
    product = db.query(Product).filter(Product.id == payload.product_id, Product.is_active == True).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    order = Order(
        telegram_user_id=payload.telegram_user_id or None,
        telegram_username=payload.telegram_username,
        telegram_first_name=payload.telegram_first_name,
        product_id=payload.product_id,
        product_name=product.name,
        payment_proof=payload.payment_proof,
        payment_type=payload.payment_type,
        status="pending",
    )
    db.add(order)
    db.commit()
    db.refresh(order)

    try:
        message_id = await _send_to_admin(order.id, product.name, order)
        if message_id:
            order.admin_message_id = message_id
            db.commit()
    except Exception:
        pass

    return order
