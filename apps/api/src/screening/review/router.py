"""HTTP routes for job review. The web app reaches them as /api/jobs/... via the Next rewrite."""

from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from screening.db import get_session
from screening.review import service
from screening.review.dependencies import reviewer_name
from screening.review.schemas import JobOut, RequirementCreate

router = APIRouter(prefix="/jobs", tags=["job review"])


@router.get("/{job_id}")
async def get_job(job_id: UUID, session: AsyncSession = Depends(get_session)) -> JobOut:
    return await service.load_job_payload(session, job_id)


@router.post("/{job_id}/requirements", status_code=status.HTTP_201_CREATED)
async def add_requirement(
    job_id: UUID,
    body: RequirementCreate,
    reviewer: str = Depends(reviewer_name),
    session: AsyncSession = Depends(get_session),
) -> JobOut:
    change = service.add_requirement(session, text=body.text, kind=body.kind, reviewer=reviewer)
    return await service.write_requirements(session, job_id, change)
