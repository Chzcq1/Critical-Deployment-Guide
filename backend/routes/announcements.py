from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from backend.database import get_db
from backend.models import Announcement
from backend.schemas import AnnouncementCreate, AnnouncementUpdate, AnnouncementResponse
from backend.routes.admin import get_admin

router = APIRouter()


@router.get("/announcements", response_model=List[AnnouncementResponse])
def list_announcements(db: Session = Depends(get_db)):
    return db.query(Announcement).filter(Announcement.is_active == True).order_by(Announcement.id.desc()).all()


@router.get("/admin/announcements", response_model=List[AnnouncementResponse])
def admin_list_announcements(db: Session = Depends(get_db), admin: dict = Depends(get_admin)):
    return db.query(Announcement).order_by(Announcement.id.desc()).all()


@router.post("/admin/announcements", response_model=AnnouncementResponse, status_code=201)
def create_announcement(body: AnnouncementCreate, db: Session = Depends(get_db), admin: dict = Depends(get_admin)):
    ann = Announcement(**body.model_dump())
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


@router.delete("/admin/announcements/{ann_id}")
def delete_announcement(ann_id: int, db: Session = Depends(get_db), admin: dict = Depends(get_admin)):
    ann = db.query(Announcement).filter(Announcement.id == ann_id).first()
    if not ann:
        raise HTTPException(status_code=404, detail="Announcement not found")
    db.delete(ann)
    db.commit()
    return {"message": "Deleted"}
