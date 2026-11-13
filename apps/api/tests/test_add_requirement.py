import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from helpers import REVIEWER, job_row, mark_job_reviewed, requirement_texts
from seed import ENGINEER_JOB_ID, MISSING_JOB_ID, NURSE_JOB_ID

URL = f"/jobs/{NURSE_JOB_ID}/requirements"


async def test_creates_added_approved_requirement_at_the_end(
    client: AsyncClient, session: AsyncSession
) -> None:
    before = await requirement_texts(session, NURSE_JOB_ID)

    response = await client.post(URL, json={"text": "  Fluent in French  "})

    assert response.status_code == 201
    requirements = response.json()["requirements"]
    assert [r["position"] for r in requirements] == list(range(1, len(before) + 2))
    added = requirements[-1]
    assert added["text"] == "Fluent in French"
    assert added["kind"] == "must_have"
    assert added["origin"] == "added"
    assert added["position"] == len(before) + 1
    assert added["source_quote"] is None
    assert added["updated_by"] == REVIEWER
    assert added["reviewed_at"] is not None
    assert await requirement_texts(session, NURSE_JOB_ID) == [*before, "Fluent in French"]


async def test_uses_the_given_kind(client: AsyncClient) -> None:
    response = await client.post(URL, json={"text": "Speaks Tagalog", "kind": "nice_to_have"})

    assert response.status_code == 201
    assert response.json()["requirements"][-1]["kind"] == "nice_to_have"


async def test_bumps_job_updated_at(client: AsyncClient, session: AsyncSession) -> None:
    response = await client.post(URL, json={"text": "Fluent in French"})

    job = await job_row(session, NURSE_JOB_ID)
    assert job["updated_at"] is not None
    assert response.json()["updated_at"] is not None


async def test_clears_the_job_review(client: AsyncClient, session: AsyncSession) -> None:
    await mark_job_reviewed(session, NURSE_JOB_ID)

    response = await client.post(URL, json={"text": "Fluent in French"})

    assert response.status_code == 201
    assert (response.json()["reviewed_at"], response.json()["reviewed_by"]) == (None, None)
    job = await job_row(session, NURSE_JOB_ID)
    assert (job["reviewed_at"], job["reviewed_by"]) == (None, None)


async def test_accepts_500_characters(client: AsyncClient) -> None:
    response = await client.post(URL, json={"text": "x" * 500})

    assert response.status_code == 201


@pytest.mark.parametrize("text", ["", "   ", "x" * 501])
async def test_rejects_empty_or_too_long_text(
    client: AsyncClient, session: AsyncSession, text: str
) -> None:
    before = await requirement_texts(session, NURSE_JOB_ID)

    response = await client.post(URL, json={"text": text})

    assert response.status_code == 422
    assert await requirement_texts(session, NURSE_JOB_ID) == before


@pytest.mark.parametrize(
    "body",
    [
        {"text": "Fluent in French", "kind": "required"},
        {"text": "Fluent in French", "origin": "extracted"},
        {"text": "Fluent in French", "position": 1},
        {"kind": "must_have"},
    ],
)
async def test_rejects_invalid_body(client: AsyncClient, body: dict[str, object]) -> None:
    response = await client.post(URL, json=body)

    assert response.status_code == 422


async def test_rejects_duplicate_text_ignoring_case_and_spaces(
    client: AsyncClient, session: AsyncSession
) -> None:
    existing = (await requirement_texts(session, NURSE_JOB_ID))[0]
    before = await requirement_texts(session, NURSE_JOB_ID)

    response = await client.post(URL, json={"text": f"  {existing.upper()} "})

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "duplicate_text"
    assert await requirement_texts(session, NURSE_JOB_ID) == before
    assert (await job_row(session, NURSE_JOB_ID))["updated_at"] is None


async def test_same_text_in_another_job_is_allowed(
    client: AsyncClient, session: AsyncSession
) -> None:
    other_job_text = (await requirement_texts(session, ENGINEER_JOB_ID))[0]

    response = await client.post(URL, json={"text": other_job_text})

    assert response.status_code == 201


@pytest.mark.parametrize("header", [None, "", "   ", "x" * 101])
async def test_requires_reviewer_header(
    client: AsyncClient, session: AsyncSession, header: str | None
) -> None:
    client.headers.pop("X-Reviewer-Name")
    headers = {} if header is None else {"X-Reviewer-Name": header}

    response = await client.post(URL, json={"text": "Fluent in French"}, headers=headers)

    assert response.status_code == 422
    assert "Fluent in French" not in await requirement_texts(session, NURSE_JOB_ID)


async def test_trims_reviewer_name(client: AsyncClient) -> None:
    response = await client.post(
        URL, json={"text": "Fluent in French"}, headers={"X-Reviewer-Name": "  Sam  "}
    )

    assert response.json()["requirements"][-1]["updated_by"] == "Sam"


async def test_unknown_job_is_404(client: AsyncClient) -> None:
    response = await client.post(
        f"/jobs/{MISSING_JOB_ID}/requirements", json={"text": "Fluent in French"}
    )

    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "not_found"


async def test_failed_write_leaves_earlier_setup_intact(
    client: AsyncClient, session: AsyncSession
) -> None:
    # Guards the harness: an API rollback must undo only its own request.
    await mark_job_reviewed(session, NURSE_JOB_ID)
    existing = (await requirement_texts(session, NURSE_JOB_ID))[0]

    response = await client.post(URL, json={"text": existing})

    assert response.status_code == 409
    assert (await job_row(session, NURSE_JOB_ID))["reviewed_by"] == "Earlier Reviewer"
