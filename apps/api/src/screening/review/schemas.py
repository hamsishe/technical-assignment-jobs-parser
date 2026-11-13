"""Request and response shapes (spec §5)."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from screening.review.models import Kind, Origin


class RequirementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    text: str
    kind: Kind
    origin: Origin
    position: int
    source_quote: str | None
    created_at: datetime
    # The concurrency token: writes send it back as `expected_updated_at`.
    updated_at: datetime
    updated_by: str | None
    reviewed_at: datetime | None


class JobOut(BaseModel):
    """The full job payload. GET returns it and so does every successful write."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    location: str
    description: str
    updated_at: datetime | None
    reviewed_at: datetime | None
    reviewed_by: str | None
    requirements: list[RequirementOut]
