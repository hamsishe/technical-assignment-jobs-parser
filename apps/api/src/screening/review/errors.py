"""Business errors in the shape the client parses: `{"detail": {"code", "message"}}`."""

from typing import Literal

from fastapi import HTTPException, status

ErrorCode = Literal[
    "not_found",
    "stale",
    "duplicate_text",
    "too_few_requirements",
    "not_all_approved",
]


def api_error(status_code: int, code: ErrorCode, message: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def job_not_found() -> HTTPException:
    return api_error(status.HTTP_404_NOT_FOUND, "not_found", "Job not found.")
