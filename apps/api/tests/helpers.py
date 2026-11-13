"""Small DB helpers shared by the API tests."""

from typing import Any
from uuid import UUID

from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Sent as X-Reviewer-Name by the `client` fixture.
REVIEWER = "Alex Recruiter"


async def job_row(session: AsyncSession, job_id: UUID) -> dict[str, Any]:
    row = await session.execute(
        text("select updated_at, reviewed_at, reviewed_by from jobs where id = :job"),
        {"job": job_id},
    )
    return dict(row.mappings().one())


async def requirement_texts(session: AsyncSession, job_id: UUID) -> list[str]:
    rows = await session.scalars(
        text("select text from requirements where job_id = :job order by position"),
        {"job": job_id},
    )
    return list(rows)


async def mark_job_reviewed(session: AsyncSession, job_id: UUID) -> None:
    await session.execute(
        text(
            "update jobs set reviewed_at = now(), reviewed_by = 'Earlier Reviewer' where id = :job"
        ),
        {"job": job_id},
    )
    await session.commit()


async def api_requirements(client: AsyncClient, job_id: UUID) -> list[dict[str, Any]]:
    """Requirements as the client sees them, with `updated_at` as the exact token string."""
    response = await client.get(f"/jobs/{job_id}")
    assert response.status_code == 200
    requirements: list[dict[str, Any]] = response.json()["requirements"]
    return requirements


def find(job: dict[str, Any], requirement_id: str) -> dict[str, Any]:
    return next(r for r in job["requirements"] if r["id"] == requirement_id)
