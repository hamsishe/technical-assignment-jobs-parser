"""The constraints the review feature relies on, checked against Postgres."""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from seed import NURSE_JOB_ID, SEED_JOB_IDS


async def positions(session: AsyncSession, job_id: object) -> list[int]:
    rows = await session.scalars(
        text("select position from requirements where job_id = :job order by position"),
        {"job": job_id},
    )
    return list(rows)


async def test_seed_positions_are_contiguous_per_job(session: AsyncSession) -> None:
    for job_id in SEED_JOB_IDS:
        found = await positions(session, job_id)
        assert found == list(range(1, len(found) + 1)), job_id
        assert found, job_id


async def test_seed_starts_unreviewed_and_untouched(session: AsyncSession) -> None:
    jobs = (
        await session.execute(text("select updated_at, reviewed_at, reviewed_by from jobs"))
    ).all()
    assert jobs
    assert all(row == (None, None, None) for row in jobs)

    touched = await session.scalar(
        text(
            "select count(*) from requirements"
            " where updated_by is not null or reviewed_at is not null"
        )
    )
    assert touched == 0


@pytest.mark.parametrize(
    "assignment",
    ["reviewed_at = now()", "reviewed_by = 'Alex'"],
)
async def test_job_review_fields_are_both_set_or_both_null(
    session: AsyncSession, assignment: str
) -> None:
    with pytest.raises(IntegrityError, match="jobs_review_both_or_neither"):
        async with session.begin_nested():
            await session.execute(
                text(f"update jobs set {assignment} where id = :job"), {"job": NURSE_JOB_ID}
            )


async def test_job_review_fields_can_be_set_together(session: AsyncSession) -> None:
    await session.execute(
        text("update jobs set reviewed_at = now(), reviewed_by = 'Alex' where id = :job"),
        {"job": NURSE_JOB_ID},
    )
    reviewed_by = await session.scalar(
        text("select reviewed_by from jobs where id = :job"), {"job": NURSE_JOB_ID}
    )
    assert reviewed_by == "Alex"


async def test_positions_can_shift_within_one_transaction(session: AsyncSession) -> None:
    # Swap positions 1 and 2. Between the two statements both rows hold 2, which an
    # immediate unique check would reject; the deferred one only checks the end state.
    params = {"job": NURSE_JOB_ID}
    first = await session.scalar(
        text("select id from requirements where job_id = :job and position = 1"), params
    )
    await session.execute(
        text("update requirements set position = 2 where id = :id"), {"id": first}
    )
    await session.execute(
        text(
            "update requirements set position = 1 where job_id = :job and position = 2"
            " and id <> :id"
        ),
        {**params, "id": first},
    )
    await session.execute(text("set constraints requirements_job_position_key immediate"))

    moved = await session.scalar(
        text("select position from requirements where id = :id"), {"id": first}
    )
    assert moved == 2
    found = await positions(session, NURSE_JOB_ID)
    assert found == list(range(1, len(found) + 1))


async def test_duplicate_positions_are_rejected_at_check_time(session: AsyncSession) -> None:
    with pytest.raises(IntegrityError, match="requirements_job_position_key"):
        async with session.begin_nested():
            await session.execute(
                text("update requirements set position = 1 where job_id = :job and position = 2"),
                {"job": NURSE_JOB_ID},
            )
            await session.execute(text("set constraints requirements_job_position_key immediate"))
