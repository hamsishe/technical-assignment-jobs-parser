from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from screening.db import get_session

app = FastAPI(title="Requirements review")

# Wide open, so the web app on any port can talk to this.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health(session: AsyncSession = Depends(get_session)) -> dict[str, object]:
    """Smoke test for the status page.

    This is also the only example in here of getting a database session. It
    deliberately uses neither an ORM model nor a response model - how you do
    that is one of the things we are interested in.
    """
    try:
        jobs = await session.scalar(text("select count(*) from jobs"))
    except Exception:  # a health check is the one place a bare except earns its keep
        return {"api": "ok", "database": "unreachable", "jobs": 0}
    return {"api": "ok", "database": "ok", "jobs": jobs}


# ---------------------------------------------------------------------------
# Your work starts here.
#
# The screen needs to read one job's requirements and save the recruiter's
# edits back. The routes, the models, and the request and response shapes are
# yours to design.
#
# The tables and columns are documented in db/01-schema.sql.
# ---------------------------------------------------------------------------
