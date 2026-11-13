// Browser client for the Job Review API (spec §5).
//
// Calls go through the `/api` rewrite in next.config.ts, so this module only works in
// the browser (Client Components); a relative URL has no origin on the server.
// Every successful write returns the full job payload, which replaces client state.

import {
  API_ERROR_CODES,
  type ApiErrorCode,
  type Job,
  type NewRequirement,
  type RequirementChanges,
} from "./types";

/** Stands in for a signed-in user (BR-13). Sent as `X-Reviewer-Name` on every write. */
export const REVIEWER_NAME = "Recruiter";

const BASE = "/api";

/** The server answered with a non-2xx status (or a 2xx that is not a job). */
export class ApiError extends Error {
  readonly kind = "http";

  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** The request never got a response: offline, DNS, connection refused, CORS. */
export class NetworkError extends Error {
  readonly kind = "network";

  constructor(options?: { cause?: unknown }) {
    super("Couldn't reach the server.", options);
    this.name = "NetworkError";
  }
}

/** Errors worth a Retry: no response at all, or a 5xx (spec §6 "Errors & network failures"). */
export function isTransient(error: unknown): boolean {
  return (
    error instanceof NetworkError || (error instanceof ApiError && error.status >= 500)
  );
}

export function getJob(jobId: string, options: { signal?: AbortSignal } = {}): Promise<Job> {
  return request("GET", jobPath(jobId), { signal: options.signal });
}

export function addRequirement(jobId: string, requirement: NewRequirement): Promise<Job> {
  return request("POST", `${jobPath(jobId)}/requirements`, { body: requirement });
}

export function patchRequirement(
  jobId: string,
  requirementId: string,
  expectedUpdatedAt: string,
  changes: RequirementChanges,
): Promise<Job> {
  return request("PATCH", requirementPath(jobId, requirementId), {
    body: { ...changes, expected_updated_at: expectedUpdatedAt },
  });
}

export function deleteRequirement(
  jobId: string,
  requirementId: string,
  expectedUpdatedAt: string,
): Promise<Job> {
  // The token has a `+hh:mm` offset; unencoded, `+` would reach the server as a space.
  const query = new URLSearchParams({ expected_updated_at: expectedUpdatedAt });
  return request("DELETE", `${requirementPath(jobId, requirementId)}?${query}`);
}

export function approveJob(jobId: string): Promise<Job> {
  return request("POST", `${jobPath(jobId)}/review`);
}

function jobPath(jobId: string): string {
  return `${BASE}/jobs/${encodeURIComponent(jobId)}`;
}

function requirementPath(jobId: string, requirementId: string): string {
  return `${jobPath(jobId)}/requirements/${encodeURIComponent(requirementId)}`;
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

async function request(
  method: Method,
  url: string,
  options: { body?: object; signal?: AbortSignal } = {},
): Promise<Job> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (method !== "GET") headers["X-Reviewer-Name"] = REVIEWER_NAME;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      // The job is live data under concurrent edits; never answer from the HTTP cache.
      cache: "no-store",
      signal: options.signal,
    });
  } catch (error) {
    // An abort is the caller's choice, not a failure: let it through unchanged.
    if (options.signal?.aborted) throw error;
    throw new NetworkError({ cause: error });
  }

  const body = await readJson(response);

  if (!response.ok) throw toApiError(response.status, body);
  if (!isJob(body)) {
    throw new ApiError(response.status, "invalid_response", "The server sent an unexpected response.");
  }
  return body;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function toApiError(status: number, body: unknown): ApiError {
  const detail = isObject(body) ? body.detail : undefined;

  // Our errors: { detail: { code, message } }.
  if (isObject(detail) && typeof detail.code === "string") {
    const message = typeof detail.message === "string" ? detail.message : fallbackMessage(status);
    const known = (API_ERROR_CODES as readonly string[]).includes(detail.code);
    return new ApiError(status, known ? (detail.code as ApiErrorCode) : "unknown", message);
  }

  // FastAPI's default 422: { detail: [{ loc, msg, type }, …] }.
  if (status === 422) {
    const messages = Array.isArray(detail)
      ? detail.flatMap((item) => (isObject(item) && typeof item.msg === "string" ? [item.msg] : []))
      : [];
    return new ApiError(
      status,
      "validation_error",
      messages.length > 0 ? messages.join("; ") : fallbackMessage(status),
    );
  }

  if (status >= 500) return new ApiError(status, "server_error", fallbackMessage(status));

  const message = typeof detail === "string" ? detail : fallbackMessage(status);
  return new ApiError(status, "unknown", message);
}

function fallbackMessage(status: number): string {
  if (status === 422) return "The server rejected the input.";
  if (status >= 500) return "The server had a problem. Try again.";
  return `Request failed (${status}).`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// A shallow check: enough to catch an HTML error page or a wrong endpoint, not a schema.
function isJob(value: unknown): value is Job {
  return isObject(value) && typeof value.id === "string" && Array.isArray(value.requirements);
}
