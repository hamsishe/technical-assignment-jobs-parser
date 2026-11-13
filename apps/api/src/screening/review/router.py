"""HTTP routes for job review. The web app reaches them as /api/jobs/... via the Next rewrite."""

from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from pydantic import AwareDatetime
from sqlalchemy.ext.asyncio import AsyncSession

from screening.db import get_session
from screening.review import service
from screening.review.dependencies import reviewer_name
from screening.review.schemas import JobOut, RequirementCreate, RequirementPatch

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


@router.patch("/{job_id}/requirements/{requirement_id}")
async def patch_requirement(
    job_id: UUID,
    requirement_id: UUID,
    body: RequirementPatch,
    reviewer: str = Depends(reviewer_name),
    session: AsyncSession = Depends(get_session),
) -> JobOut:
    change = service.patch_requirement(session, requirement_id, body, reviewer=reviewer)
    return await service.write_requirements(session, job_id, change)


# A delete stores no name, but every write must carry the reviewer header (BR-13).
@router.delete("/{job_id}/requirements/{requirement_id}", dependencies=[Depends(reviewer_name)])
async def delete_requirement(
    job_id: UUID,
    requirement_id: UUID,
    expected_updated_at: AwareDatetime = Query(
        description="The requirement's updated_at as last read. URL-encode it: '+' in an offset."
    ),
    session: AsyncSession = Depends(get_session),
) -> JobOut:
    change = service.delete_requirement(
        session, requirement_id, expected_updated_at=expected_updated_at
    )
    return await service.write_requirements(session, job_id, change)


@router.post("/{job_id}/review")
async def approve_job(
    job_id: UUID,
    reviewer: str = Depends(reviewer_name),
    session: AsyncSession = Depends(get_session),
) -> JobOut:
    return await service.approve_job(session, job_id, reviewer=reviewer)
