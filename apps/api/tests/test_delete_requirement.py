from datetime import datetime
from typing import Any

from httpx import AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession

from helpers import api_requirements, job_row
from seed import ENGINEER_JOB_ID, MISSING_JOB_ID, NURSE_JOB_ID


async def delete(
    client: AsyncClient, row: dict[str, Any], job_id: object = NURSE_JOB_ID
) -> Response:
    # `params` URL-encodes the token, as the web client must.
    return await client.delete(
        f"/jobs/{job_id}/requirements/{row['id']}",
        params={"expected_updated_at": row["updated_at"]},
    )


def positions(rows: list[dict[str, Any]]) -> list[int]:
    return [r["position"] for r in rows]


async def test_delete_from_the_middle_compacts_positions(
    client: AsyncClient, session: AsyncSession
) -> None:
    before = await api_requirements(client, NURSE_JOB_ID)
    middle = before[len(before) // 2]

    response = await delete(client, middle)

    assert response.status_code == 200
    after = response.json()["requirements"]
    assert positions(after) == list(range(1, len(before)))
    assert [r["id"] for r in after] == [r["id"] for r in before if r["id"] != middle["id"]]
    assert await api_requirements(client, NURSE_JOB_ID) == after
    assert (await job_row(session, NURSE_JOB_ID))["updated_at"] is not None


async def test_delete_first_and_last(client: AsyncClient) -> None:
    before = await api_requirements(client, NURSE_JOB_ID)

    await delete(client, before[0])
    after = (await delete(client, before[-1])).json()["requirements"]

    assert positions(after) == list(range(1, len(before) - 1))
    assert [r["id"] for r in after] == [r["id"] for r in before[1:-1]]


async def test_delete_is_allowed_below_three_requirements(client: AsyncClient) -> None:
    rows = await api_requirements(client, NURSE_JOB_ID)

    for row in rows:
        response = await delete(client, row)
        assert response.status_code == 200

    assert await api_requirements(client, NURSE_JOB_ID) == []


async def test_stale_token_is_409_and_deletes_nothing(client: AsyncClient) -> None:
    row = (await api_requirements(client, NURSE_JOB_ID))[0]
    await client.patch(
        f"/jobs/{NURSE_JOB_ID}/requirements/{row['id']}",
        json={"expected_updated_at": row["updated_at"], "approved": True},
    )
    before = await api_requirements(client, NURSE_JOB_ID)

    response = await delete(client, row)

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "stale"
    assert await api_requirements(client, NURSE_JOB_ID) == before


async def test_token_with_a_plus_offset_matches_when_encoded(client: AsyncClient) -> None:
    row = (await api_requirements(client, NURSE_JOB_ID))[0]
    as_plus_offset = datetime.fromisoformat(row["updated_at"]).isoformat()
    assert as_plus_offset.endswith("+00:00")

    response = await delete(client, {**row, "updated_at": as_plus_offset})

    assert response.status_code == 200


async def test_requirement_of_another_job_is_404(client: AsyncClient) -> None:
    engineer_rows = await api_requirements(client, ENGINEER_JOB_ID)

    response = await delete(client, engineer_rows[0], job_id=NURSE_JOB_ID)

    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "not_found"
    assert await api_requirements(client, ENGINEER_JOB_ID) == engineer_rows


async def test_unknown_job_is_404(client: AsyncClient) -> None:
    row = (await api_requirements(client, NURSE_JOB_ID))[0]

    response = await delete(client, row, job_id=MISSING_JOB_ID)

    assert response.status_code == 404


async def test_missing_token_is_422(client: AsyncClient) -> None:
    row = (await api_requirements(client, NURSE_JOB_ID))[0]

    response = await client.delete(f"/jobs/{NURSE_JOB_ID}/requirements/{row['id']}")

    assert response.status_code == 422


async def test_missing_reviewer_header_is_422(client: AsyncClient) -> None:
    rows = await api_requirements(client, NURSE_JOB_ID)
    client.headers.pop("X-Reviewer-Name")

    response = await delete(client, rows[0])

    assert response.status_code == 422
    assert await api_requirements(client, NURSE_JOB_ID) == rows
