from datetime import datetime
from typing import Any

import pytest
from httpx import AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession

from helpers import (
    REVIEWER,
    api_requirements,
    find,
    job_row,
    mark_job_reviewed,
    requirement_texts,
)
from seed import ENGINEER_JOB_ID, MISSING_JOB_ID, NURSE_JOB_ID


def url(requirement_id: str, job_id: object = NURSE_JOB_ID) -> str:
    return f"/jobs/{job_id}/requirements/{requirement_id}"


async def row_at(client: AsyncClient, index: int = 0) -> dict[str, Any]:
    return (await api_requirements(client, NURSE_JOB_ID))[index]


async def patch(client: AsyncClient, row: dict[str, Any], **changes: object) -> Response:
    """PATCH `row` the way the web app does: with the token it last read."""
    return await client.patch(
        url(row["id"]), json={"expected_updated_at": row["updated_at"], **changes}
    )


async def patched(client: AsyncClient, row: dict[str, Any], **changes: object) -> dict[str, Any]:
    response = await patch(client, row, **changes)
    assert response.status_code == 200, response.text
    return find(response.json(), row["id"])


# --- text and origin (BR-6, BR-11) -------------------------------------------------------


async def test_text_change_on_extracted_row_makes_it_edited(
    client: AsyncClient, session: AsyncSession
) -> None:
    row = await row_at(client)

    saved = await patched(client, row, text="  Ontario RN licence in good standing ")

    assert saved["text"] == "Ontario RN licence in good standing"
    assert saved["origin"] == "edited"
    assert saved["source_quote"] == row["source_quote"]
    assert saved["updated_by"] == REVIEWER
    assert saved["updated_at"] != row["updated_at"]
    assert saved["position"] == row["position"]
    assert (await job_row(session, NURSE_JOB_ID))["updated_at"] is not None


async def test_text_change_on_edited_row_stays_edited(client: AsyncClient) -> None:
    once = await patched(client, await row_at(client), text="First edit")

    twice = await patched(client, once, text="Second edit")

    assert twice["origin"] == "edited"


async def test_text_change_on_added_row_stays_added(client: AsyncClient) -> None:
    response = await client.post(f"/jobs/{NURSE_JOB_ID}/requirements", json={"text": "Mine"})
    mine = response.json()["requirements"][-1]

    saved = await patched(client, mine, text="Mine, reworded")

    assert saved["origin"] == "added"


async def test_kind_only_change_keeps_origin(client: AsyncClient) -> None:
    row = await row_at(client)
    other = "nice_to_have" if row["kind"] == "must_have" else "must_have"

    saved = await patched(client, row, kind=other)

    assert saved["kind"] == other
    assert saved["origin"] == "extracted"
    assert saved["text"] == row["text"]


async def test_case_only_text_change_is_a_change(client: AsyncClient) -> None:
    row = await row_at(client)

    saved = await patched(client, row, text=row["text"].upper())

    assert saved["text"] == row["text"].upper()
    assert saved["origin"] == "edited"


# --- approval (BR-8) ---------------------------------------------------------------------


async def test_approved_true_sets_and_false_clears_reviewed_at(client: AsyncClient) -> None:
    row = await row_at(client)
    assert row["reviewed_at"] is None

    approved = await patched(client, row, approved=True)
    assert approved["reviewed_at"] is not None
    assert approved["origin"] == "extracted"

    unapproved = await patched(client, approved, approved=False)
    assert unapproved["reviewed_at"] is None


@pytest.mark.parametrize("field", ["text", "kind"])
async def test_edits_keep_approval(client: AsyncClient, field: str) -> None:
    approved = await patched(client, await row_at(client), approved=True)
    other_kind = "nice_to_have" if approved["kind"] == "must_have" else "must_have"
    edit = {"text": "Reworded"} if field == "text" else {"kind": other_kind}

    edited = await patched(client, approved, **edit)

    assert edited[field] == edit[field]
    assert edited["reviewed_at"] == approved["reviewed_at"]


async def test_approve_with_pending_text_in_one_request(client: AsyncClient) -> None:
    row = await row_at(client)

    saved = await patched(client, row, text="Reworded before approving", approved=True)

    assert saved["text"] == "Reworded before approving"
    assert saved["origin"] == "edited"
    assert saved["reviewed_at"] is not None


# --- no-op (Q1) --------------------------------------------------------------------------


async def test_unchanged_patch_is_a_no_op(client: AsyncClient, session: AsyncSession) -> None:
    await mark_job_reviewed(session, NURSE_JOB_ID)
    row = await row_at(client)

    response = await patch(client, row, text=f"  {row['text']}  ", kind=row["kind"])

    assert response.status_code == 200
    job = response.json()
    assert find(job, row["id"]) == row
    assert job["updated_at"] is None
    assert job["reviewed_by"] == "Earlier Reviewer"
    assert (await job_row(session, NURSE_JOB_ID))["updated_at"] is None


async def test_approving_an_approved_row_is_a_no_op(client: AsyncClient) -> None:
    approved = await patched(client, await row_at(client), approved=True)

    again = await patched(client, approved, approved=True)

    assert again == approved


# --- concurrency (BR-12) -----------------------------------------------------------------


async def test_chained_writes_with_fresh_tokens_succeed(client: AsyncClient) -> None:
    row = await row_at(client)

    one = await patched(client, row, text="One")
    two = await patched(client, one, text="Two")
    three = await patched(client, two, approved=True)

    assert three["text"] == "Two"
    tokens = [datetime.fromisoformat(r["updated_at"]) for r in (row, one, two, three)]
    assert tokens == sorted(set(tokens))  # each write moves the token strictly forward (D1)


async def test_stale_token_is_409_and_writes_nothing(
    client: AsyncClient, session: AsyncSession
) -> None:
    row = await row_at(client)
    await patched(client, row, text="Saved in another tab")
    job_before = await job_row(session, NURSE_JOB_ID)

    response = await patch(client, row, text="Saved from a stale copy")

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "stale"
    assert (await row_at(client))["text"] == "Saved in another tab"
    assert await job_row(session, NURSE_JOB_ID) == job_before


async def test_stale_check_runs_before_the_no_op_check(client: AsyncClient) -> None:
    row = await row_at(client)
    await patched(client, row, approved=True)

    response = await patch(client, row, text=row["text"])

    assert response.status_code == 409


# --- not found ---------------------------------------------------------------------------


async def test_requirement_of_another_job_is_404(client: AsyncClient) -> None:
    engineer_row = (await api_requirements(client, ENGINEER_JOB_ID))[0]

    response = await client.patch(
        url(engineer_row["id"], job_id=NURSE_JOB_ID),
        json={"expected_updated_at": engineer_row["updated_at"], "text": "Hijacked"},
    )

    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "not_found"
    assert (await api_requirements(client, ENGINEER_JOB_ID))[0] == engineer_row


async def test_unknown_requirement_is_404(client: AsyncClient) -> None:
    row = await row_at(client)

    response = await client.patch(
        url(str(MISSING_JOB_ID)), json={"expected_updated_at": row["updated_at"], "approved": True}
    )

    assert response.status_code == 404


async def test_unknown_job_is_404(client: AsyncClient) -> None:
    row = await row_at(client)

    response = await client.patch(
        url(row["id"], job_id=MISSING_JOB_ID),
        json={"expected_updated_at": row["updated_at"], "approved": True},
    )

    assert response.status_code == 404


# --- validation --------------------------------------------------------------------------


async def test_duplicate_text_is_409(client: AsyncClient, session: AsyncSession) -> None:
    rows = await api_requirements(client, NURSE_JOB_ID)
    before = await requirement_texts(session, NURSE_JOB_ID)

    response = await patch(client, rows[0], text=f" {rows[1]['text'].lower()} ")

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "duplicate_text"
    assert await requirement_texts(session, NURSE_JOB_ID) == before


@pytest.mark.parametrize(
    "changes",
    [
        {},
        {"origin": "edited", "text": "x"},
        {"position": 3, "text": "x"},
        {"source_quote": "x", "text": "x"},
        {"updated_by": "x", "text": "x"},
        {"kind": "required"},
        {"text": ""},
        {"text": "   "},
        {"text": "x" * 501},
        {"text": None},
        {"approved": None},
        {"approved": "maybe"},
    ],
)
async def test_invalid_body_is_422(client: AsyncClient, changes: dict[str, object]) -> None:
    row = await row_at(client)

    response = await patch(client, row, **changes)

    assert response.status_code == 422
    assert await row_at(client) == row


@pytest.mark.parametrize("token", [None, "yesterday", "2026-11-13T14:02:03.123456"])
async def test_missing_or_naive_token_is_422(client: AsyncClient, token: str | None) -> None:
    row = await row_at(client)
    body: dict[str, object] = {"approved": True}
    if token is not None:
        body["expected_updated_at"] = token

    response = await client.patch(url(row["id"]), json=body)

    assert response.status_code == 422


async def test_missing_reviewer_header_is_422(client: AsyncClient) -> None:
    row = await row_at(client)
    client.headers.pop("X-Reviewer-Name")

    response = await patch(client, row, approved=True)

    assert response.status_code == 422


# --- job review (BR-2, BR-4) -------------------------------------------------------------


async def test_write_clears_the_job_review(client: AsyncClient, session: AsyncSession) -> None:
    await mark_job_reviewed(session, NURSE_JOB_ID)

    response = await patch(client, await row_at(client), approved=True)

    assert (response.json()["reviewed_at"], response.json()["reviewed_by"]) == (None, None)
    job = await job_row(session, NURSE_JOB_ID)
    assert (job["reviewed_at"], job["reviewed_by"]) == (None, None)
    assert job["updated_at"] is not None
