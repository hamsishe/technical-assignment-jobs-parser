from datetime import datetime

import pytest
from httpx import AsyncClient
from pydantic import TypeAdapter
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from seed import MISSING_JOB_ID, NURSE_JOB_ID

JOB_KEYS = {
    "id",
    "title",
    "location",
    "description",
    "updated_at",
    "reviewed_at",
    "reviewed_by",
    "requirements",
}
REQUIREMENT_KEYS = {
    "id",
    "text",
    "kind",
    "origin",
    "position",
    "source_quote",
    "created_at",
    "updated_at",
    "updated_by",
    "reviewed_at",
}


async def test_returns_job_with_requirements(client: AsyncClient) -> None:
    response = await client.get(f"/jobs/{NURSE_JOB_ID}")

    assert response.status_code == 200
    job = response.json()
    assert set(job) == JOB_KEYS
    assert job["id"] == str(NURSE_JOB_ID)
    assert job["title"] == "Registered Nurse - Long Term Care"
    assert job["location"] == "Toronto, ON"
    assert job["description"].startswith("A 180-bed long term care residence")
    assert (job["updated_at"], job["reviewed_at"], job["reviewed_by"]) == (None, None, None)

    requirements = job["requirements"]
    assert requirements
    assert all(set(r) == REQUIREMENT_KEYS for r in requirements)
    assert [r["position"] for r in requirements] == list(range(1, len(requirements) + 1))
    assert all(r["origin"] == "extracted" for r in requirements)
    assert any(r["source_quote"] is None for r in requirements)


async def test_requirements_come_in_position_order(
    client: AsyncClient, session: AsyncSession
) -> None:
    # Reverse the positions so table order and position order disagree.
    await session.execute(
        text(
            "update requirements set position = n + 1 - position"
            " from (select count(*) as n from requirements where job_id = :job) c"
            " where job_id = :job"
        ),
        {"job": NURSE_JOB_ID},
    )
    expected = list(
        await session.scalars(
            text("select text from requirements where job_id = :job order by position"),
            {"job": NURSE_JOB_ID},
        )
    )

    response = await client.get(f"/jobs/{NURSE_JOB_ID}")

    assert [r["text"] for r in response.json()["requirements"]] == expected


async def test_unknown_job_is_404(client: AsyncClient) -> None:
    response = await client.get(f"/jobs/{MISSING_JOB_ID}")

    assert response.status_code == 404
    assert response.json() == {"detail": {"code": "not_found", "message": "Job not found."}}


async def test_malformed_job_id_is_422(client: AsyncClient) -> None:
    response = await client.get("/jobs/not-a-uuid")

    assert response.status_code == 422


async def test_get_needs_no_reviewer_header(client: AsyncClient) -> None:
    response = await client.get(f"/jobs/{NURSE_JOB_ID}")

    assert "X-Reviewer-Name" not in response.request.headers
    assert response.status_code == 200


@pytest.mark.parametrize(
    "stored",
    ["2026-11-13 14:02:03.123456+00", "2026-11-13 14:02:03+00", "2026-11-13 09:02:03.5-05"],
)
async def test_updated_at_round_trips_exactly(
    client: AsyncClient, session: AsyncSession, stored: str
) -> None:
    # The client sends `updated_at` back as `expected_updated_at`, and the API compares it
    # with `=` (BR-12). The JSON string must parse back to exactly the stored instant.
    first_id = await session.scalar(
        text("select id from requirements where job_id = :job and position = 1"),
        {"job": NURSE_JOB_ID},
    )
    await session.execute(
        text(
            "update requirements set updated_at = cast(cast(:at as text) as timestamptz)"
            " where id = :id"
        ),
        {"at": stored, "id": first_id},
    )

    response = await client.get(f"/jobs/{NURSE_JOB_ID}")
    sent = response.json()["requirements"][0]["updated_at"]

    parsed = TypeAdapter(datetime).validate_python(sent)
    assert parsed.tzinfo is not None
    stored_instant = await session.scalar(
        text("select updated_at from requirements where id = :id"), {"id": first_id}
    )
    assert parsed == stored_instant  # microseconds survive the trip
    matches = await session.scalar(
        text("select count(*) from requirements where id = :id and updated_at = :at"),
        {"id": first_id, "at": parsed},
    )
    assert matches == 1
