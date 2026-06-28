from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from backend.database import get_db
from backend.models import Product, StoreSettings
from backend.schemas import ProductResponse, ProductCreate, ProductUpdate

router = APIRouter()


def _get_active_catalog(db: Session) -> str:
    row = db.query(StoreSettings).filter(StoreSettings.key == "active_catalog").first()
    return (row.value or "A") if row else "A"


@router.get("/products", response_model=List[ProductResponse])
def list_products(db: Session = Depends(get_db)):
    active = _get_active_catalog(db)
    products = (
        db.query(Product)
        .filter(Product.is_active == True, Product.catalog_group == active)
        .order_by(Product.sort_order.asc(), Product.id.asc())
        .all()
    )
    return products
