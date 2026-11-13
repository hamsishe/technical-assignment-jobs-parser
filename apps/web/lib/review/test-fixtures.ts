// Test-only builders for job payloads and stubbed `fetch` responses (spec §5 shape).
// Imported by *.test.tsx files only.

import type { Job, Requirement } from "./types";

export const JOB_ID = "22222222-2222-4222-8222-222222222222";

let counter = 0;

export function makeRequirement(overrides: Partial<Requirement> = {}): Requirement {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    text: `Requirement ${counter}`,
    kind: "must_have",
    origin: "extracted",
    position: counter,
    source_quote: `quote ${counter}`,
    created_at: "2026-11-01T09:00:00Z",
    updated_at: "2026-11-01T09:00:00Z",
    updated_by: null,
    reviewed_at: null,
    ...overrides,
  };
}

export function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: JOB_ID,
    title: "Registered Nurse - Long Term Care",
    location: "Toronto, ON",
    description: "A 180-bed long term care residence is hiring registered nurses.",
    updated_at: null,
    reviewed_at: null,
    reviewed_by: null,
    requirements: [],
    ...overrides,
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function errorResponse(status: number, code: string, message = code): Response {
  return jsonResponse({ detail: { code, message } }, status);
}

/** The payload the API returns after a write: the job stamped `at`, with `changes` applied. */
export function withChange(job: Job, at: string, id: string, changes: Partial<Requirement>): Job {
  return {
    ...job,
    updated_at: at,
    requirements: job.requirements.map((r) =>
      r.id === id ? { ...r, ...changes, updated_at: at } : r,
    ),
  };
}

/** The payload after a delete: the row gone and later positions shifted up (BR-7). */
export function withoutRequirement(job: Job, at: string, id: string): Job {
  const removed = job.requirements.find((r) => r.id === id);
  return {
    ...job,
    updated_at: at,
    requirements: job.requirements
      .filter((r) => r.id !== id)
      .map((r) =>
        removed !== undefined && r.position > removed.position ? { ...r, position: r.position - 1 } : r,
      ),
  };
}
