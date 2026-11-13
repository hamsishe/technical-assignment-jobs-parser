"""ORM models for the two tables. Column meanings are documented in db/01-schema.sql."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from sqlalchemy import FetchedValue, ForeignKey, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

Kind = Literal["must_have", "nice_to_have"]
Origin = Literal["extracted", "edited", "added"]


class Base(DeclarativeBase):
    pass


class Job(Base):
    __tablename__ = "jobs"

    # Defaults to gen_random_uuid() in the database.
    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=FetchedValue())
    title: Mapped[str]
    location: Mapped[str]
    description: Mapped[str]
    created_at: Mapped[datetime]
    updated_at: Mapped[datetime | None]
    reviewed_at: Mapped[datetime | None]
    reviewed_by: Mapped[str | None]


class Requirement(Base):
    __tablename__ = "requirements"

    # Defaults to gen_random_uuid() in the database.
    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=FetchedValue())
    job_id: Mapped[UUID] = mapped_column(ForeignKey("jobs.id"))
    text: Mapped[str]
    kind: Mapped[Kind] = mapped_column(String)
    origin: Mapped[Origin] = mapped_column(String)
    position: Mapped[int]
    source_quote: Mapped[str | None]
    created_at: Mapped[datetime]
    updated_at: Mapped[datetime]
    updated_by: Mapped[str | None]
    reviewed_at: Mapped[datetime | None]
