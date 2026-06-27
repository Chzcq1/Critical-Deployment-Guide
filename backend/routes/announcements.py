from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List
from backend.database import get_db
from backend.models import Announcement
from backend.schemas import AnnouncementCreate, AnnouncementUpdate, AnnouncementResponse
from backend.routes.admin import get_admin

router = APIRouter()


@router.get("/announcements", response_model=List[AnnouncementResponse])
def list_announcements(db: Session = Depends(get_db)):
    return db.query(Announcement).filter(Announcement.is_active == True).order_by(Announcement.sort_order.asc(), Announcement.id.desc()).all()


@router.get("/admin/announcements", response_model=List[AnnouncementResponse])
def admin_list_announcements(db: Session = Depends(get_db), admin: dict = Depends(get_admin)):
    return db.query(Announcement).order_by(Announcement.sort_order.asc(), Announcement.id.desc()).all()


@router.post("/admin/announcements", response_model=AnnouncementResponse, status_code=201)
def create_announcement(body: AnnouncementCreate, db: Session = Depends(get_db), admin: dict = Depends(get_admin)):
    max_order = db.query(Announcement).count()
    ann = Announcement(**body.model_dump(), sort_order=max_order)
    db.add(ann)
    db.commit()
    db.refresh(ann)
    return ann


@router.put("/admin/announcements/{ann_id}", response_model=AnnouncementResponse)
def update_announcement(ann_id: int, body: AnnouncementUpdate, db: Session = Depends(get_db), admin: dict = Depends(get_admin)):
    ann = db.query(Announcement).filter(Announcement.id == ann_id).first()
    if not ann:
        raise HTTPException(status_code=404, detail="Announcement not found")
    for key, val in body.model_dump(exclude_unset=True).items():
        setattr(ann, key, val)
    db.commit()
    db.refresh(ann)
    return ann


@router.post("/admin/announcements/{ann_id}/move")
def move_announcement(ann_id: int, direction: str = Query(..., pattern="^(up|down)$"), db: Session = Depends(get_db), admin: dict = Depends(get_admin)):
    all_anns = db.query(Announcement).order_by(Announcement.sort_order.asc(), Announcement.id.desc()).all()
    idx = next((i for i, a in enumerate(all_anns) if a.id == ann_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Announcement not found")

    if direction == "up" and idx > 0:
        swap = all_anns[idx - 1]
    elif direction == "down" and idx < len(all_anns) - 1:
        swap = all_anns[idx + 1]
    else:
        return {"message": "Already at boundary"}

    current = all_anns[idx]
    current.sort_order, swap.sort_order = swap.sort_order, current.sort_order
    db.commit()
    return {"message": "Moved"}


@router.delete("/admin/announcements/{ann_id}")
def delete_announcement(ann_id: int, db: Session = Depends(get_db), admin: dict = Depends(get_admin)):
    ann = db.query(Announcement).filter(Announcement.id == ann_id).first()
    if not ann:
        raise HTTPException(status_code=404, detail="Announcement not found")
    db.delete(ann)
    db.commit()
    return {"message": "Deleted"}
