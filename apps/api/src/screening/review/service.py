"""Reads and writes for job review, independent of HTTP."""

from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import status
from sqlalchemy import delete, exists, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from screening.review.errors import (
    api_error,
    job_not_found,
    requirement_not_found,
    stale_requirement,
)
from screening.review.models import Job, Kind, Requirement
from screening.review.schemas import JobOut, RequirementOut, RequirementPatch

# A change to a job's requirements. Runs with the job row locked; returns whether it wrote
# anything, so a no-op leaves the job's `updated_at` and review alone.
RequirementChange = Callable[[Job], Awaitable[bool]]


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


async def lock_job(session: AsyncSession, job_id: UUID) -> Job:
    """Lock the job row for the rest of the transaction. Raises 404 if it is missing.

    Every write takes this lock first, so writes to one job run one at a time: concurrent
    adds cannot collide on position, and approving the job cannot race a requirement change.
    """
    job = await session.scalar(
        select(Job)
        .where(Job.id == job_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if job is None:
        raise job_not_found()
    return job


async def run_locked(
    session: AsyncSession, job_id: UUID, work: Callable[[Job], Awaitable[None]]
) -> JobOut:
    """Run `work` as one transaction with the job row locked, and return the new payload.

    The payload is read inside the transaction, so it is exactly what was committed. Any
    error rolls everything back.
    """
    try:
        job = await lock_job(session, job_id)
        await work(job)
        payload = await load_job_payload(session, job_id)
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    return payload


async def write_requirements(
    session: AsyncSession, job_id: UUID, change: RequirementChange
) -> JobOut:
    """Run one requirement write and return the new payload.

    If `change` wrote anything, also stamps `jobs.updated_at` (BR-2) and clears the job's
    review (BR-4) in the same transaction.
    """

    async def work(job: Job) -> None:
        if await change(job):
            await session.execute(
                update(Job)
                .where(Job.id == job.id)
                .values(updated_at=func.clock_timestamp(), reviewed_at=None, reviewed_by=None)
            )

    return await run_locked(session, job_id, work)


async def ensure_unique_text(
    session: AsyncSession, job_id: UUID, text: str, *, ignore_id: UUID | None = None
) -> None:
    """BR-10: no two requirements of a job share text, ignoring case and outer whitespace."""
    same_text = (
        select(Requirement.id)
        .where(Requirement.job_id == job_id)
        .where(func.lower(func.btrim(Requirement.text)) == func.lower(func.btrim(text)))
    )
    if ignore_id is not None:
        same_text = same_text.where(Requirement.id != ignore_id)
    if await session.scalar(select(exists(same_text))):
        raise api_error(
            status.HTTP_409_CONFLICT,
            "duplicate_text",
            "This job already has a requirement with the same text.",
        )


def add_requirement(
    session: AsyncSession, *, text: str, kind: Kind, reviewer: str
) -> RequirementChange:
    """New requirement: origin `added`, last position, approved on creation (BR-6/7/8)."""

    async def change(job: Job) -> bool:
        await ensure_unique_text(session, job.id, text)
        next_position = select(func.coalesce(func.max(Requirement.position), 0) + 1).where(
            Requirement.job_id == job.id
        )
        await session.execute(
            insert(Requirement).values(
                job_id=job.id,
                text=text,
                kind=kind,
                origin="added",
                position=next_position.scalar_subquery(),
                created_at=func.clock_timestamp(),
                updated_at=func.clock_timestamp(),
                updated_by=reviewer,
                reviewed_at=func.clock_timestamp(),
            )
        )
        return True

    return change


async def load_current_requirement(
    session: AsyncSession, job: Job, requirement_id: UUID, expected_updated_at: datetime
) -> Requirement:
    """The requirement as the client must have last seen it. Call under the job lock.

    404 if it does not exist or belongs to another job; 409 `stale` if it changed since the
    client read it (BR-12). The token is compared exactly: writes stamp `clock_timestamp()`,
    so every write moves it forward.
    """
    requirement = await session.scalar(
        select(Requirement)
        .where(Requirement.id == requirement_id, Requirement.job_id == job.id)
        .execution_options(populate_existing=True)
    )
    if requirement is None:
        raise requirement_not_found()
    if requirement.updated_at != expected_updated_at:
        raise stale_requirement()
    return requirement


def patch_requirement(
    session: AsyncSession, requirement_id: UUID, patch: RequirementPatch, *, reviewer: str
) -> RequirementChange:
    """Edit text and/or kind, approve or unapprove. A patch that changes nothing is a no-op (Q1).

    - Text change on an `extracted` row makes it `edited`; other origins stay (BR-6).
    - Text or kind edits keep approval; only `approved` sets or clears it (BR-8).
    - `source_quote` is never touched (BR-11).
    """

    async def change(job: Job) -> bool:
        current = await load_current_requirement(
            session, job, requirement_id, patch.expected_updated_at
        )
        values: dict[str, Any] = {}
        if patch.text is not None and patch.text != current.text:
            await ensure_unique_text(session, job.id, patch.text, ignore_id=current.id)
            values["text"] = patch.text
            if current.origin == "extracted":
                values["origin"] = "edited"
        if patch.kind is not None and patch.kind != current.kind:
            values["kind"] = patch.kind
        if patch.approved is True and current.reviewed_at is None:
            values["reviewed_at"] = func.clock_timestamp()
        if patch.approved is False and current.reviewed_at is not None:
            values["reviewed_at"] = None
        if not values:
            return False
        await session.execute(
            update(Requirement)
            .where(Requirement.id == current.id)
            .values(**values, updated_at=func.clock_timestamp(), updated_by=reviewer)
        )
        return True

    return change


def delete_requirement(
    session: AsyncSession, requirement_id: UUID, *, expected_updated_at: datetime
) -> RequirementChange:
    """Delete a requirement and move the ones after it up by one, keeping 1..n (BR-7).

    The position constraint is deferred to commit, so the shift cannot trip over itself.
    No minimum count here: BR-9 is checked only when the job is approved.
    """

    async def change(job: Job) -> bool:
        current = await load_current_requirement(session, job, requirement_id, expected_updated_at)
        await session.execute(delete(Requirement).where(Requirement.id == current.id))
        await session.execute(
            update(Requirement)
            .where(Requirement.job_id == job.id, Requirement.position > current.position)
            .values(position=Requirement.position - 1)
        )
        return True

    return change


MIN_REQUIREMENTS_TO_APPROVE = 3


async def approve_job(session: AsyncSession, job_id: UUID, *, reviewer: str) -> JobOut:
    """Mark the job reviewed (BR-3), if it has >= 3 requirements, all approved (BR-9).

    Runs under the job lock, so no requirement write can slip in between the check and the
    stamp. Does not touch `jobs.updated_at`, which counts requirement writes only (D7).
    Approving an already reviewed job keeps the original reviewer and time (Q2): any
    requirement write since would have cleared the review, so the rules still hold.
    """

    async def work(job: Job) -> None:
        if job.reviewed_at is not None:
            return
        total, approved = (
            await session.execute(
                select(func.count(), func.count(Requirement.reviewed_at)).where(
                    Requirement.job_id == job.id
                )
            )
        ).one()
        if total < MIN_REQUIREMENTS_TO_APPROVE:
            raise api_error(
                status.HTTP_409_CONFLICT,
                "too_few_requirements",
                f"A job needs at least {MIN_REQUIREMENTS_TO_APPROVE} requirements to be "
                f"approved. It has {total}.",
            )
        if approved < total:
            raise api_error(
                status.HTTP_409_CONFLICT,
                "not_all_approved",
                f"Approve every requirement first. {total - approved} of {total} not approved.",
            )
        await session.execute(
            update(Job)
            .where(Job.id == job.id)
            .values(reviewed_at=func.clock_timestamp(), reviewed_by=reviewer)
        )

    return await run_locked(session, job_id, work)
