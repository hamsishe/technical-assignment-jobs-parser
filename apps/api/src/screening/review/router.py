"""HTTP routes for job review. The web app reaches them as /api/jobs/... via the Next rewrite."""

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from screening.db import get_session
from screening.review.schemas import JobOut
from screening.review.service import load_job_payload

router = APIRouter(prefix="/jobs", tags=["job review"])


@router.get("/{job_id}")
async def get_job(job_id: UUID, session: AsyncSession = Depends(get_session)) -> JobOut:
    return await load_job_payload(session, job_id)
