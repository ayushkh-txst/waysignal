"""Shared report review workflow. Storage is additive to the G-one hazard table."""
from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import uuid4

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import DateTime, Integer, String, Text, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.api.v1.hazards import Hazard, list_hazards, public_report, utc
from app.core.database import Base


class Review(Base):
    __tablename__ = "waysignal_hazard_reviews"
    hazard_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    decision: Mapped[str] = mapped_column(String(24))
    note: Mapped[str] = mapped_column(Text, default="")
    actor: Mapped[str] = mapped_column(String(128))
    reviewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(Integer, default=1)


class ReviewEvent(Base):
    __tablename__ = "waysignal_review_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    hazard_id: Mapped[str] = mapped_column(String(40), index=True)
    decision: Mapped[str] = mapped_column(String(24))
    note: Mapped[str] = mapped_column(Text)
    actor: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ReviewInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: Literal["reviewed_active", "rejected"]
    note: str = Field(default="", max_length=500)
    expected_version: int = Field(default=0, ge=0)


def review_state(report: dict, review: Review | None, now: datetime) -> str:
    updated = datetime.fromisoformat(report["updated_at"].replace("Z", "+00:00"))
    # Legacy reopen operations invalidate prior review evidence.
    reopened = review and report["status"] == "active" and updated > utc(review.reviewed_at)
    if review and review.decision == "rejected" and not reopened:
        return "rejected"
    if report["status"] == "resolved":
        return "resolved"
    observed = utc(review.reviewed_at) if review and not reopened else datetime.fromisoformat(report["created_at"].replace("Z", "+00:00"))
    if now - observed > timedelta(hours=24):
        return "expired"
    return review.decision if review and not reopened else "unreviewed"


class CommunityService:
    def __init__(self, db: Session, actor: dict):
        self.db, self.actor = db, actor

    def reports(self) -> list[dict]:
        records = list_hazards(status="all", reporter=self.actor, db=self.db)
        reviews = {r.hazard_id: r for r in self.db.scalars(select(Review)).all()}
        now = datetime.now(timezone.utc)
        result = []
        for record in records:
            report = record.model_dump(mode="json")
            review = reviews.get(record.id)
            report.update(review_state=review_state(report, review, now),
                          review_version=review.version if review else 0,
                          review_note=review.note if review else "",
                          reviewed_at=utc(review.reviewed_at).isoformat() if review else None)
            result.append(report)
        return sorted(result, key=lambda x: x["updated_at"], reverse=True)

    def review(self, hazard_id: str, payload: ReviewInput) -> dict:
        if self.actor["role"] != "worker":
            raise HTTPException(403, "Only responders can review reports.")
        row = self.db.get(Hazard, hazard_id)
        if row is None:
            raise HTTPException(404, "Report not found.")
        if row.status != "active":
            raise HTTPException(409, "Reopen the report before reviewing it.")
        now = datetime.now(timezone.utc)
        values = dict(decision=payload.decision, note=payload.note, actor=self.actor["sub"],
                      reviewed_at=now, version=payload.expected_version + 1)
        try:
            if payload.expected_version == 0:
                self.db.add(Review(hazard_id=hazard_id, **values))
                self.db.flush()
            else:
                result = self.db.execute(update(Review).where(Review.hazard_id == hazard_id,
                    Review.version == payload.expected_version).values(**values))
                if result.rowcount != 1:
                    self.db.rollback()
                    raise HTTPException(409, "This review changed. Refresh before retrying.")
            row.updated_at = now
            if payload.decision == "rejected":
                row.status, row.resolved_at, row.resolved_by = "resolved", now, self.actor["sub"]
            self.db.add(ReviewEvent(id=str(uuid4()), hazard_id=hazard_id, decision=payload.decision,
                note=payload.note, actor=self.actor["sub"], created_at=now))
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            raise HTTPException(409, "This review changed. Refresh before retrying.") from None
        return next(r for r in self.reports() if r["id"] == hazard_id)

    def history(self, hazard_id: str) -> list[dict]:
        if self.db.get(Hazard, hazard_id) is None:
            raise HTTPException(404, "Report not found.")
        rows = self.db.scalars(select(ReviewEvent).where(ReviewEvent.hazard_id == hazard_id)
                               .order_by(ReviewEvent.created_at)).all()
        return [{"id": r.id, "decision": r.decision, "note": r.note,
                 "source": "Responder review", "created_at": utc(r.created_at).isoformat()} for r in rows]
