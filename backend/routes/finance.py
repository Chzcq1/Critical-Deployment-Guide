import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, text
from backend.database import get_db
from backend.models import FinanceEntry, StoreSettings
from backend.schemas import FinanceEntryCreate, FinanceEntryResponse, FinanceSummary
from backend.routes.admin import get_admin, _get_setting, _set_setting
from backend import bot as bot_module

router = APIRouter()


@router.get("/admin/finance/summary", response_model=FinanceSummary)
def get_finance_summary(db: Session = Depends(get_db), admin: dict = Depends(get_admin)):
    entries = db.query(FinanceEntry).all()

    total = Decimal("0")
    admin_balances: dict = {}
    for e in entries:
        amt = Decimal(str(e.amount))
        total += amt
        name = e.admin_name
        admin_balances[name] = admin_balances.get(name, Decimal("0")) + amt

    monthly_goal_str = _get_setting(db, "finance_monthly_goal")
    try:
        monthly_goal = Decimal(monthly_goal_str) if monthly_goal_str else Decimal("0")
    except Exception:
        monthly_goal = Decimal("0")

    now = datetime.now(timezone.utc)
    daily_map: dict = {}
    for i in range(6, -1, -1):
        d = (now - timedelta(days=i)).strftime("%d/%m")
        daily_map[d] = Decimal("0")

    for e in entries:
        if e.created_at:
            entry_dt = e.created_at
            if entry_dt.tzinfo is None:
                entry_dt = entry_dt.replace(tzinfo=timezone.utc)
            delta = (now - entry_dt).days
            if delta <= 6:
                day_key = entry_dt.strftime("%d/%m")
                if day_key in daily_map:
                    daily_map[day_key] += Decimal(str(e.amount))

    daily_chart = [{"date": k, "amount": float(v)} for k, v in daily_map.items()]

    return FinanceSummary(
        total_balance=total,
        admin_balances={k: float(v) for k, v in admin_balances.items()},
        daily_chart=daily_chart,
        monthly_goal=monthly_goal,
    )


@router.get("/admin/finance/entries", response_model=List[FinanceEntryResponse])
def list_finance_entries(db: Session = Depends(get_db), admin: dict = Depends(get_admin)):
    return db.query(FinanceEntry).order_by(FinanceEntry.id.desc()).all()


@router.post("/admin/finance/entries", response_model=FinanceEntryResponse, status_code=201)
async def create_finance_entry(
    body: FinanceEntryCreate,
    db: Session = Depends(get_db),
    admin: dict = Depends(get_admin),
):
    entry = FinanceEntry(
        amount=body.amount,
        description=body.description,
        admin_name=body.admin_name,
        entry_type=body.entry_type,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)

    sign = "+" if float(body.amount) >= 0 else ""
    action = "ถอนเงิน" if body.entry_type == "withdrawal" else "เพิ่มรายได้"
    try:
        await bot_module.send_finance_notification(
            action=action,
            description=body.description,
            amount=float(body.amount),
            admin_name=body.admin_name,
        )
    except Exception:
        pass

    return entry


@router.delete("/admin/finance/entries/{entry_id}")
async def delete_finance_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    admin: dict = Depends(get_admin),
):
    entry = db.query(FinanceEntry).filter(FinanceEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    db.delete(entry)
    db.commit()
    return {"message": "Deleted"}


@router.put("/admin/finance/goal")
def set_monthly_goal(
    body: dict,
    db: Session = Depends(get_db),
    admin: dict = Depends(get_admin),
):
    goal = str(body.get("goal", "0"))
    _set_setting(db, "finance_monthly_goal", goal)
    db.commit()
    return {"goal": goal}
