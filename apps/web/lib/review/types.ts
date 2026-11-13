// Types for the Job Review API (spec §5).
//
// Timestamps are kept as the exact strings the server sent. `updated_at` doubles as
// the concurrency token: the API compares `expected_updated_at` by exact equality, so
// parsing it into a `Date` (millisecond precision) and back would make every write stale.

export const KINDS = ["must_have", "nice_to_have"] as const;
export type Kind = (typeof KINDS)[number];

export const ORIGINS = ["extracted", "edited", "added"] as const;
export type Origin = (typeof ORIGINS)[number];

export interface Requirement {
  id: string;
  text: string;
  kind: Kind;
  origin: Origin;
  position: number;
  source_quote: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  reviewed_at: string | null;
}

export interface Job {
  id: string;
  title: string;
  location: string;
  description: string;
  updated_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  requirements: Requirement[];
}

export interface NewRequirement {
  text: string;
  kind?: Kind;
}

type ChangeFields = { text: string; kind: Kind; approved: boolean };

/** A PATCH must change at least one of `text`, `kind`, `approved` (spec §5). */
export type RequirementChanges = Partial<ChangeFields> &
  (Pick<ChangeFields, "text"> | Pick<ChangeFields, "kind"> | Pick<ChangeFields, "approved">);

/** Codes the API sends in `{ detail: { code, message } }`. */
export const API_ERROR_CODES = [
  "not_found",
  "stale",
  "duplicate_text",
  "too_few_requirements",
  "not_all_approved",
] as const;

/**
 * `validation_error`: a 422 (FastAPI's default body).
 * `server_error`: any 5xx, including the Next proxy failing to reach the API.
 * `invalid_response`: a 2xx whose body is not a job payload.
 * `unknown`: any other status, or a code this client does not know.
 */
export type ApiErrorCode =
  | (typeof API_ERROR_CODES)[number]
  | "validation_error"
  | "server_error"
  | "invalid_response"
  | "unknown";
