"""Request and response shapes (spec §5)."""

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, StringConstraints, model_validator

from screening.review.models import Kind, Origin

# BR-5: stored trimmed, 1-500 characters. Shared by POST and PATCH.
RequirementText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)
]

# BR-13: the stand-in for a signed-in user, sent on every write.
ReviewerName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
]


class RequirementCreate(BaseModel):
    """POST body. The server sets origin, position and approval (BR-6, BR-7, BR-8)."""

    model_config = ConfigDict(extra="forbid")

    text: RequirementText
    kind: Kind = "must_have"


class RequirementPatch(BaseModel):
    """PATCH body: a change to text, kind and/or approval, against the version the client read.

    Fields left out are unchanged. Explicit nulls are rejected rather than read as "unchanged".
    """

    model_config = ConfigDict(extra="forbid")

    # The requirement's `updated_at` as the client last read it (BR-12). Must carry an offset,
    # since it is compared with the stored instant.
    expected_updated_at: AwareDatetime
    text: RequirementText | None = None
    kind: Kind | None = None
    approved: bool | None = None

    @model_validator(mode="after")
    def changes_something(self) -> "RequirementPatch":
        changes = self.model_fields_set & {"text", "kind", "approved"}
        if not changes:
            raise ValueError("Send at least one of text, kind or approved.")
        nulls = sorted(name for name in changes if getattr(self, name) is None)
        if nulls:
            raise ValueError(f"{', '.join(nulls)} cannot be null.")
        return self


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
