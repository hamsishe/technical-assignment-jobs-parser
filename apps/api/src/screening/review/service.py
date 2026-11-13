"""Reads and writes for job review, independent of HTTP."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from screening.review.errors import job_not_found
from screening.review.models import Job, Requirement
from screening.review.schemas import JobOut, RequirementOut


async def load_job_payload(session: AsyncSession, job_id: UUID) -> JobOut:
    """The job and its requirements in position order. Raises 404 if the job is missing.

    `populate_existing` makes the read reflect the database even when this session already
    holds the rows, e.g. after bulk updates in the same write transaction.
    """
    job = await session.scalar(
        select(Job).where(Job.id == job_id).execution_options(populate_existing=True)
    )
    if job is None:
        raise job_not_found()
    requirements = await session.scalars(
        select(Requirement)
        .where(Requirement.job_id == job_id)
        .order_by(Requirement.position)
        .execution_options(populate_existing=True)
    )
    return JobOut(
        id=job.id,
        title=job.title,
        location=job.location,
        description=job.description,
        updated_at=job.updated_at,
        reviewed_at=job.reviewed_at,
        reviewed_by=job.reviewed_by,
        requirements=[RequirementOut.model_validate(r) for r in requirements],
    )
