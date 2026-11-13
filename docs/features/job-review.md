# Feature: Job Review

## 1. Context

A machine reads a job description and extracts requirements. It gets things wrong: it invents
requirements that aren't in the text, sets the wrong importance, and misses some. A recruiter
reviews the list before it is used. **Whatever the recruiter saves is what every candidate for
that job is screened against**, so the saved data must always be correct and never silently lost.

The recruiter can approve, edit (text and/or kind), delete and add requirements, and then mark
the job as reviewed.

Tables: `jobs`, `requirements` (see `db/01-schema.sql`).

Out of scope: sign-in (the reviewer name is hardcoded in the web app), a job list, extraction,
reordering requirements, editing job title/location/description, editing `source_quote`, review
history/audit log.

## 2. Use cases

Actor: Recruiter.

| #   | Scenario | Expected result |
| --- | -------- | --------------- |
| UC1 | Opens the review page for a job. | Sees title, location, review status and last change date in the header; the description and the requirements (in `position` order) in the body. Nothing is written. |
| UC2 | Approves every requirement one by one. | Each approval is saved immediately. Approved rows become read-only text. |
| UC3 | Works through the list using the description: approves, edits text or kind, deletes. | Each action is saved immediately. A text change on an `extracted` row sets `origin = edited`. |
| UC4 | Changes only the kind of a requirement. | Kind is saved. `origin` stays the same (an `extracted` row stays `extracted`). |
| UC5 | Closes the page mid-review. | Every action already completed is in the DB. If something is unsaved, failed or still in flight, the browser warns before leaving. |
| UC6 | Adds a requirement: types text, picks kind (default `must_have`), clicks **Add**. | Saved with `origin = added`, last position, approved. Empty text is rejected. |
| UC7 | Types into the add form but doesn't click **Add**, then tries to leave. | The browser shows its leave-page warning. |
| UC8 | Comes back later. | Sees the date of the last change and, if reviewed, who reviewed the job and when. |
| UC9 | Finishes and clicks **Approve job**. | The job is marked reviewed (`reviewed_at`, `reviewed_by`). Only allowed when BR-9 holds. |

## 3. Business rules

**Job**

- BR-1. A job must exist. Unknown job id → 404. The job's content fields (`title`, `location`,
  `description`) are never null. The review metadata (`updated_at`, `reviewed_at`,
  `reviewed_by`) is null until it is first set.
- BR-2. Every recruiter write to a job's requirements (add, edit, approve, delete) sets
  `jobs.updated_at = now()` in the same transaction.
- BR-3. A job is reviewed if and only if `jobs.reviewed_at is not null`. `reviewed_at` and
  `reviewed_by` are both set or both null.
- BR-4. Any requirement write (add, edit, approve, delete) after the job was reviewed clears
  `jobs.reviewed_at` and `jobs.reviewed_by`, so the job has to be approved again.

**Requirement**

- BR-5. Every requirement has `text` (trimmed, 1–500 chars), `kind` ∈ {`must_have`,
  `nice_to_have`}, `origin` ∈ {`extracted`, `edited`, `added`}, and `position` (1-based).
  `source_quote` is optional.
- BR-6. **The server sets `origin`. The client never sends it.**
  - New requirement → `added`.
  - Text changed on an `extracted` row → `edited`.
  - Text changed on an `edited` or `added` row → unchanged.
  - Kind-only change → unchanged.
  - Text equal to the current text after trimming → not a change (no write, no origin flip).
- BR-7. Positions within a job are unique and contiguous (1..n). A new requirement takes
  `max(position) + 1`. A delete shifts the rows after it up by one.
- BR-8. Requirement approval:
  - Approving a requirement sets `requirements.reviewed_at = now()`.
  - An approved requirement stays approved when its text or kind is edited and saved: the
    recruiter's saved edit counts as their decision. Unsaved drafts change nothing on the server.
  - A requirement added by the recruiter is approved when it is created.
- BR-9. The job can be approved only if it has **at least 3 requirements** and **all of them are
  approved**. Deletes are not limited; the count is checked only here.
- BR-10. Duplicate text within a job (case-insensitive, trimmed) is rejected.
- BR-11. `source_quote` is read-only. It is kept when the text is edited, because it still points
  to where the requirement came from.
- BR-12. Concurrent writes: an edit or delete made against a stale copy of a requirement is
  rejected with 409, never silently overwritten.
- BR-13. Reviewer identity: no sign-in yet. The web app holds one constant, `REVIEWER_NAME`, and
  sends it on every write. The API stores it in `requirements.updated_by` and
  `jobs.reviewed_by`.

## 4. DB schema changes

Edit `db/01-schema.sql`, run `just reset` (it wipes data), and record the reason in `NOTES.md`.

```sql
-- jobs
updated_at  timestamptz,   -- last recruiter change to this job's requirements; null = never touched
reviewed_at timestamptz,   -- null = not reviewed
reviewed_by text,          -- who approved the job; null when reviewed_at is null
check ((reviewed_at is null) = (reviewed_by is null))

-- requirements
created_at  timestamptz not null default now(),
updated_at  timestamptz not null default now(),  -- also the concurrency token (BR-12)
updated_by  text,          -- last recruiter who wrote it; null = untouched extraction
reviewed_at timestamptz,   -- null = not approved
unique (job_id, position) deferrable initially deferred   -- replaces requirements_job_position_idx
```

- `reviewed_by` and `updated_by` are nullable: unreviewed jobs and untouched extracted rows have
  no reviewer.
- Every write transaction locks the job row first (`select … for update`). This serializes
  writes per job, so concurrent adds cannot collide on `position`, and approving the job cannot
  race a requirement change.

## 5. API

The web app calls `/api/...`. The Next rewrite strips `/api`, so FastAPI serves the paths below.
Requirement routes are nested under the job, and a requirement that belongs to a different job
returns 404.

**Every successful write returns the full job payload** (same shape as GET). The client
replaces its server state with it, so job-level side effects (`updated_at`, a cleared review,
renumbered positions) never drift.

Every write request carries the header `X-Reviewer-Name: <REVIEWER_NAME>` (trimmed, 1–100
chars). If it's missing or empty the API returns 422. The header stands in for a signed-in user;
when sign-in arrives it gets replaced, and the endpoints stay the same.

| Method | Path | Body | Success |
| ------ | ---- | ---- | ------- |
| GET    | `/jobs/{job_id}` | none | 200 Job |
| POST   | `/jobs/{job_id}/requirements` | `{ text, kind? = "must_have" }` | 201 Job |
| PATCH  | `/jobs/{job_id}/requirements/{id}` | `{ expected_updated_at, text?, kind?, approved? }` | 200 Job |
| DELETE | `/jobs/{job_id}/requirements/{id}?expected_updated_at=…` | none | 200 Job |
| POST   | `/jobs/{job_id}/review` | none | 200 Job |

Job payload:

```json
{
  "id": "…", "title": "…", "location": "…", "description": "…",
  "updated_at": "…|null", "reviewed_at": "…|null", "reviewed_by": "…|null",
  "requirements": [
    { "id": "…", "text": "…", "kind": "must_have", "origin": "extracted",
      "position": 1, "source_quote": "…|null",
      "created_at": "…", "updated_at": "…", "updated_by": "…|null", "reviewed_at": "…|null" }
  ]
}
```

PATCH rules:

- At least one of `text`, `kind`, `approved` is required.
- `approved: true` sets `reviewed_at`; `approved: false` clears it.
- Editing `text` or `kind` never changes approval (BR-8).
- Unknown fields (including `origin`, `position`, `source_quote`, `updated_by`) → 422
  (`extra="forbid"`).

Errors:

| Status | When | Body |
| ------ | ---- | ---- |
| 404 | Job or requirement not found | `{ "detail": { "code": "not_found", "message": … } }` |
| 422 | Empty/too long text, invalid kind, unknown field, empty PATCH, missing reviewer header | FastAPI default |
| 409 | `stale` (BR-12), `duplicate_text` (BR-10), `too_few_requirements` / `not_all_approved` (job review, BR-9) | `{ "detail": { "code", "message" } }` |

All of an endpoint's writes (requirement, renumbering, `jobs.updated_at`, clearing the job review)
happen in one transaction.

## 6. Page layout & UX

Route: `/jobs/[jobId]` (start with `22222222-2222-4222-8222-222222222222`).

### Layout

```
┌ sticky header ───────────────────────────────────────────────────────────────────┐
│ Registered Nurse - Long Term Care · Toronto, ON   [Not reviewed]   [Approve job] │
│ Last change 13 Nov 2026, 14:02 · All changes saved                               │
└──────────────────────────────────────────────────────────────────────────────────┘
 A 180-bed long term care residence is hiring registered nurses for its day and
 evening rotation. You will lead a care team of personal support workers, …  (full text)

 8 of 11 approved
┌ requirement ─────────────────────────────────────────────────────────────────────┐
│ (Must have | Nice to have)  [extracted]                          [✓ Approve] [🗑] │
│ [ Active RN licence with the College of Nurses of Ontario                   ]    │
│ “hiring registered nurses”                                                       │
└──────────────────────────────────────────────────────────────────────────────────┘
┌ approved requirement ────────────────────────────────────────────────────────────┐
│ (Must have | Nice to have)  [edited]  ✓ Approved                    [✎ Edit] [🗑] │
│ Current CPR and BLS certification                                                │
│ ⚠ Not found in the job description                                               │
└──────────────────────────────────────────────────────────────────────────────────┘
┌ add requirement ─────────────────────────────────────────────────────────────────┐
│ (Must have | Nice to have)  [ New requirement…                    ]  [Add]       │
└──────────────────────────────────────────────────────────────────────────────────┘
 footer:                                              8 of 11 approved  [Approve job]
```

- **Sticky header:** title, location, review status ("Not reviewed" / "Reviewed by X · date"),
  Approve job button, last change date (`jobs.updated_at`, or "No changes yet"), and the save
  status.
- **Body:** the full job description, then the requirements list, then the add form.
- **Requirement row:**
  - The kind switch (segmented, 2 options) sits above the text and is always editable, even on
    approved rows.
  - The origin tag uses grey for `extracted`, green for `edited`, yellow for `added`.
  - The text is an input, with the `source_quote` in muted italics below it. A null quote shows
    "⚠ Not found in the job description". This is the main clue for spotting invented
    requirements.
  - The right side has **Approve** and **Delete**. An approved row shows its text as plain text,
    a ✓ badge, and **Edit** in place of Approve.
- **Add form:** kind switch (default Must have), text input, **Add** button. Enter submits.
- **Footer:** progress ("8 of 11 approved") and a second Approve job button.

### Save model (no global Save button)

| Trigger | Request | Notes |
| ------- | ------- | ----- |
| Kind switch change | PATCH `kind` right away | Optimistic. Reverted on failure. Approval unchanged. |
| Text input blur, or Enter | PATCH `text` if changed and valid | Skipped if unchanged. Escape restores the last saved text. |
| Approve | PATCH `approved: true` (plus `text` if the input has an unsaved valid change) | One request. |
| Edit (approved row) | No request | Switches the row to the input. A saved edit keeps the row approved and returns it to read-only. If the save fails or the text is invalid, the row stays in edit mode. |
| Delete | DELETE | Two-click inline confirm ("Delete" → "Confirm delete"). Permanent, no undo. |
| Add | POST | Created approved. The form clears only on success; on failure the text stays. |
| Approve job | POST review | Disabled, with the reason shown, while: fewer than 3 requirements, any requirement unapproved, any save pending/failed, or any input invalid. |

- Requests for the same requirement are sent one at a time, in order, so a slow earlier response
  cannot overwrite a later edit. Each request uses the latest `updated_at` from the previous
  response.
- After each successful write, the server payload replaces local server state. Rows with a
  local draft in progress keep the draft.
- Any write after the job was reviewed clears the review (BR-4). The header switches back to
  "Not reviewed" and shows the note "Changes made after review. Approve the job again."
- Header save status: "Saving…" / "All changes saved" / "N changes not saved".

### Validation

- Empty (after trim) or > 500 chars → red border plus an inline message. No request is sent. The
  row counts as unsaved (blocks Approve job, triggers the leave warning).
- The Add button is disabled while the input is empty. Submitting with Enter while empty marks it
  red.
- Server 422/409 messages are shown inline on the row they belong to.

### Errors & network failures

- **Network error / 5xx** on a text save: the local text is kept, the row is marked "Not saved ·
  Retry", and a snackbar shows "Couldn't save. Check your connection." with Retry. Nothing is
  rolled back silently.
- **Network error** on a kind change, approve or delete: the row reverts to the server state, and
  a snackbar offers Retry.
- **409 `stale`:** a snackbar says "This requirement was changed elsewhere", with Reload. The
  local draft stays visible until reload.
- **409 business rule** (`duplicate_text`, `too_few_requirements`, `not_all_approved`): the
  message is shown inline or in the snackbar. No retry.
- **Load failure:** full-page error with Retry. **404:** "Job not found".
- Snackbars stack. Error snackbars stay until dismissed. Success is shown only in the header
  save status, not as a snackbar.

### Leaving the page

A `beforeunload` warning (the browser's native dialog; its text can't be customized) appears
when any of these hold: the add form has text, a row has an unsaved or invalid draft, a request
is in flight, or a save failed. Anything already saved is in the DB, so closing the page with
none of these never loses data.

## 7. Acceptance tests

**API** (`apps/api/tests`, `httpx.AsyncClient` + `ASGITransport`):

- GET returns the job and its requirements ordered by position. Unknown job → 404.
- POST:
  - Creates a row with origin `added`, the last position, kind `must_have` by default, approved,
    and `updated_by` from the header.
  - Empty/whitespace/too long text → 422. Duplicate text → 409. Missing reviewer header → 422.
  - Bumps `jobs.updated_at`.
- PATCH:
  - Text change: `extracted → edited`; `added` stays `added`.
  - Text or kind edits keep approval.
  - Kind-only change keeps origin. Same text is a no-op.
  - `approved: true/false` sets/clears `reviewed_at`.
  - Sending `origin` → 422. Invalid kind → 422.
  - Stale `expected_updated_at` → 409.
  - A requirement belonging to another job → 404.
- DELETE: positions are compacted. Stale → 409. Allowed even when fewer than 3 remain.
- Review:
  - 409 `too_few_requirements` when there are fewer than 3.
  - 409 `not_all_approved` when any requirement is unapproved.
  - On success sets `reviewed_at`/`reviewed_by`.
  - Any later requirement write clears both.

**Web** (`*.test.tsx`, `fetch` stubbed):

- Renders the sticky header, the description in the body, the requirements in order, origin tags,
  and the missing-quote warning.
- Blur with changed text sends a PATCH. Unchanged text sends nothing. Empty text turns red and
  sends nothing.
- Kind switch sends a PATCH. On failure it reverts and shows a snackbar.
- Text save failure keeps the text, shows "Not saved · Retry", and the retry succeeds.
- Approve → read-only row. Edit → input. A saved edit returns to read-only and stays approved.
- Delete needs a second click to confirm.
- Add: disabled when empty. Clears on success. Keeps the text on failure.
- Approve job is disabled with fewer than 3 requirements or any unapproved. When enabled it
  posts and shows the reviewed status. A later change shows "Not reviewed" again.
- Every write sends the `X-Reviewer-Name` header.
- `beforeunload` is armed when the add form has text or a save failed.
