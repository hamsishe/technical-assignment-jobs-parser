"""Request dependencies shared by the review routes."""

from typing import Annotated

from fastapi import Header

from screening.review.schemas import ReviewerName


async def reviewer_name(
    x_reviewer_name: Annotated[ReviewerName, Header(alias="X-Reviewer-Name")],
) -> str:
    """The writer's name from `X-Reviewer-Name`, trimmed. Missing, blank or >100 chars → 422.

    Required on writes only (D6). It stands in for a signed-in user (BR-13).
    """
    return x_reviewer_name
