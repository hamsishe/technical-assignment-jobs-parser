"""Test harness: every test runs against the real Docker database inside one
outer transaction that is rolled back at the end (decision D2).

The app's session joins that transaction with ``create_savepoint``, so a
``commit()`` in a route only releases a savepoint and nothing ever persists.
Each test gets its own engine because asyncpg connections are bound to the
event loop that opened them, and pytest-asyncio gives each test a new loop.
"""

from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from screening.db import DATABASE_URL, get_session
from screening.main import app


@pytest.fixture
async def session() -> AsyncIterator[AsyncSession]:
    """A session inside a transaction that is always rolled back."""
    engine = create_async_engine(DATABASE_URL, poolclass=NullPool)
    async with engine.connect() as connection:
        transaction = await connection.begin()
        db = AsyncSession(
            bind=connection,
            join_transaction_mode="create_savepoint",
            expire_on_commit=False,
        )
        try:
            yield db
        finally:
            await db.close()
            await transaction.rollback()
    await engine.dispose()


@pytest.fixture
async def client(session: AsyncSession) -> AsyncIterator[AsyncClient]:
    """HTTP client for the app, with every request using the test's session."""

    async def override_get_session() -> AsyncIterator[AsyncSession]:
        yield session

    app.dependency_overrides[get_session] = override_get_session
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            yield c
    finally:
        app.dependency_overrides.pop(get_session, None)
