"""Test harness: every test runs against the real Docker database inside one
outer transaction that is rolled back at the end (decision D2).

Sessions join that transaction with ``create_savepoint``, so a ``commit()`` in a
route only releases a savepoint and nothing ever persists. Each API request gets
its own session on the test's connection, as in production (one session per
request): a rollback in the API undoes that request's savepoint only, never the
test's setup. Each test gets its own engine because asyncpg connections are
bound to the event loop that opened them, and pytest-asyncio gives each test a
new loop.
"""

import asyncio
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from screening.db import DATABASE_URL, get_session
from screening.main import app

from helpers import REVIEWER


async def seed_is_untouched() -> bool:
    """True if no recruiter write has happened since db/02-seed.sql was loaded.

    Every write stamps one of these columns, deletes included (they set jobs.updated_at).
    """
    engine = create_async_engine(DATABASE_URL, poolclass=NullPool)
    try:
        async with engine.connect() as conn:
            touched = await conn.scalar(
                text(
                    "select exists (select 1 from jobs"
                    "  where updated_at is not null or reviewed_at is not null)"
                    " or exists (select 1 from requirements"
                    "  where updated_by is not null or reviewed_at is not null)"
                )
            )
    finally:
        await engine.dispose()
    return not touched


@pytest.fixture(scope="session", autouse=True)
def require_fresh_seed() -> None:
    """Tests assume the seed as loaded. Using the app changes it, so stop with the fix
    up front instead of failing dozens of tests on unexpected data."""
    if not asyncio.run(seed_is_untouched()):
        pytest.exit(
            "The database has changed since it was seeded. Run `just reset`, then retry.",
            returncode=1,
        )


def joined_session(connection: AsyncConnection) -> AsyncSession:
    return AsyncSession(
        bind=connection,
        join_transaction_mode="create_savepoint",
        expire_on_commit=False,
    )


@pytest.fixture
async def connection() -> AsyncIterator[AsyncConnection]:
    """One connection inside a transaction that is always rolled back."""
    engine = create_async_engine(DATABASE_URL, poolclass=NullPool)
    async with engine.connect() as conn:
        transaction = await conn.begin()
        try:
            yield conn
        finally:
            await transaction.rollback()
    await engine.dispose()


@pytest.fixture
async def session(connection: AsyncConnection) -> AsyncIterator[AsyncSession]:
    """The test's own session, for setup and for checking what the API wrote."""
    db = joined_session(connection)
    try:
        yield db
    finally:
        await db.close()


@pytest.fixture
async def client(connection: AsyncConnection) -> AsyncIterator[AsyncClient]:
    """HTTP client for the app; each request gets a fresh session on the test's connection."""

    async def override_get_session() -> AsyncIterator[AsyncSession]:
        db = joined_session(connection)
        try:
            yield db
        finally:
            await db.close()

    app.dependency_overrides[get_session] = override_get_session
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
            headers={"X-Reviewer-Name": REVIEWER},
        ) as c:
            yield c
    finally:
        app.dependency_overrides.pop(get_session, None)
