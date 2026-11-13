from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from httpx import AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession

from helpers import (
    REVIEWER,
    api_requirements,
    approve_all_requirements,
    job_row,
    keep_first_requirements,
)
from seed import MISSING_JOB_ID, NURSE_JOB_ID

URL = f"/jobs/{NURSE_JOB_ID}/review"


async def test_approves_a_job_with_all_requirements_approved(
    client: AsyncClient, session: AsyncSession
) -> None:
    await approve_all_requirements(session, NURSE_JOB_ID)

    response = await client.post(URL)

    assert response.status_code == 200
    job = response.json()
    assert job["reviewed_by"] == REVIEWER
    assert job["reviewed_at"] is not None
    stored = await job_row(session, NURSE_JOB_ID)
    assert stored["reviewed_by"] == REVIEWER
    assert stored["reviewed_at"] is not None


async def test_does_not_touch_job_updated_at(client: AsyncClient, session: AsyncSession) -> None:
    await approve_all_requirements(session, NURSE_JOB_ID)

    response = await client.post(URL)

    assert response.json()["updated_at"] is None
    assert (await job_row(session, NURSE_JOB_ID))["updated_at"] is None


async def test_exactly_three_approved_requirements_is_enough(
    client: AsyncClient, session: AsyncSession
) -> None:
    await keep_first_requirements(session, NURSE_JOB_ID, 3)
    await approve_all_requirements(session, NURSE_JOB_ID)

    response = await client.post(URL)

    assert response.status_code == 200


@pytest.mark.parametrize("count", [0, 2])
async def test_fewer_than_three_requirements_is_409(
    client: AsyncClient, session: AsyncSession, count: int
) -> None:
    await keep_first_requirements(session, NURSE_JOB_ID, count)
    await approve_all_requirements(session, NURSE_JOB_ID)

    response = await client.post(URL)

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "too_few_requirements"
    assert (await job_row(session, NURSE_JOB_ID))["reviewed_at"] is None


async def test_any_unapproved_requirement_is_409(
    client: AsyncClient, session: AsyncSession
) -> None:
    await approve_all_requirements(session, NURSE_JOB_ID)
    row = (await api_requirements(client, NURSE_JOB_ID))[-1]
    await client.patch(
        f"/jobs/{NURSE_JOB_ID}/requirements/{row['id']}",
        json={"expected_updated_at": row["updated_at"], "approved": False},
    )

    response = await client.post(URL)

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "not_all_approved"
    assert (await job_row(session, NURSE_JOB_ID))["reviewed_at"] is None


async def test_unreviewed_seed_job_is_409(client: AsyncClient) -> None:
    response = await client.post(URL)

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "not_all_approved"


async def test_approving_a_reviewed_job_again_keeps_the_original(
    client: AsyncClient, session: AsyncSession
) -> None:
    await approve_all_requirements(session, NURSE_JOB_ID)
    first = (await client.post(URL)).json()

    response = await client.post(URL, headers={"X-Reviewer-Name": "Someone Else"})

    assert response.status_code == 200
    assert response.json() == first
    assert (await job_row(session, NURSE_JOB_ID))["reviewed_by"] == REVIEWER


async def test_unknown_job_is_404(client: AsyncClient) -> None:
    response = await client.post(f"/jobs/{MISSING_JOB_ID}/review")

    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "not_found"


async def test_missing_reviewer_header_is_422(client: AsyncClient, session: AsyncSession) -> None:
    await approve_all_requirements(session, NURSE_JOB_ID)
    client.headers.pop("X-Reviewer-Name")

    response = await client.post(URL)

    assert response.status_code == 422
    assert (await job_row(session, NURSE_JOB_ID))["reviewed_at"] is None


# --- a later requirement write clears the review (BR-4) ----------------------------------

Write = Callable[[AsyncClient, dict[str, Any]], Awaitable[Response]]


async def add(client: AsyncClient, row: dict[str, Any]) -> Response:
    return await client.post(f"/jobs/{NURSE_JOB_ID}/requirements", json={"text": "Late add"})


async def edit(client: AsyncClient, row: dict[str, Any]) -> Response:
    return await client.patch(
        f"/jobs/{NURSE_JOB_ID}/requirements/{row['id']}",
        json={"expected_updated_at": row["updated_at"], "text": "Late edit"},
    )


async def change_kind(client: AsyncClient, row: dict[str, Any]) -> Response:
    other = "nice_to_have" if row["kind"] == "must_have" else "must_have"
    return await client.patch(
        f"/jobs/{NURSE_JOB_ID}/requirements/{row['id']}",
        json={"expected_updated_at": row["updated_at"], "kind": other},
    )


async def unapprove(client: AsyncClient, row: dict[str, Any]) -> Response:
    return await client.patch(
        f"/jobs/{NURSE_JOB_ID}/requirements/{row['id']}",
        json={"expected_updated_at": row["updated_at"], "approved": False},
    )


async def remove(client: AsyncClient, row: dict[str, Any]) -> Response:
    return await client.delete(
        f"/jobs/{NURSE_JOB_ID}/requirements/{row['id']}",
        params={"expected_updated_at": row["updated_at"]},
    )


@pytest.mark.parametrize("write", [add, edit, change_kind, unapprove, remove])
async def test_a_later_requirement_write_clears_the_review(
    client: AsyncClient, session: AsyncSession, write: Write
) -> None:
    await approve_all_requirements(session, NURSE_JOB_ID)
    reviewed = (await client.post(URL)).json()
    assert reviewed["reviewed_at"] is not None

    response = await write(client, reviewed["requirements"][0])

    assert response.status_code in (200, 201)
    assert (response.json()["reviewed_at"], response.json()["reviewed_by"]) == (None, None)
    job = await job_row(session, NURSE_JOB_ID)
    assert (job["reviewed_at"], job["reviewed_by"]) == (None, None)
    assert job["updated_at"] is not None


async def test_a_no_op_write_keeps_the_review(client: AsyncClient, session: AsyncSession) -> None:
    await approve_all_requirements(session, NURSE_JOB_ID)
    reviewed = (await client.post(URL)).json()
    row = reviewed["requirements"][0]

    response = await client.patch(
        f"/jobs/{NURSE_JOB_ID}/requirements/{row['id']}",
        json={"expected_updated_at": row["updated_at"], "approved": True},
    )

    assert response.json() == reviewed
