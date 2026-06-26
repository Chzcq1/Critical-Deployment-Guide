from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from backend.database import get_db
from backend.models import Product
from backend.schemas import ProductResponse, ProductCreate, ProductUpdate

router = APIRouter()


@router.get("/products", response_model=List[ProductResponse])
def list_products(db: Session = Depends(get_db)):
    products = db.query(Product).filter(Product.is_active == True).order_by(Product.sort_order.asc(), Product.id.asc()).all()
    return products
