# Notes

Job Review: a recruiter corrects the machine-extracted requirements of one job and approves
the job. Open <http://localhost:3000/jobs/22222222-2222-4222-8222-222222222222> after
`just setup && just dev`. Spec: [docs/features/job-review.md](docs/features/job-review.md).
Plan: [docs/features/job-review.plan.md](docs/features/job-review.plan.md).

## Time spent

**Building: 71 minutes.** This is the sum of the per-task minutes logged in the Job Review atlas
(the live task board, see "How I worked with AI"):

| Task | Minutes | Task | Minutes |
| ---- | ------: | ---- | ------: |
| JR-1 schema + test harness | 6 | JR-8 review page, read-only | 4 |
| JR-2 GET job | 2 | JR-9 save engine | 5 |
| JR-3 add requirement + write transaction | 3 | JR-10 row editing | 6 |
| JR-4 edit / approve requirement | 3 | JR-11 add form + approve job | 4 |
| JR-5 delete requirement | 2 | JR-12 leave-page guard | 2 |
| JR-6 approve job | 2 | JR-13 end-to-end run | 12 |
| JR-7 web API client | 5 | JR-14 these notes | 5 |
| JR-15 shadcn/ui setup | 10 | | |

The atlas counts task work only. Writing the spec and the plan and setting up tooling are not in
it, and the API and web lanes ran as parallel sessions. The commits on 13 Nov therefore span
more wall-clock time (12:19 to the last commit) than the sum above.

## Video

TODO: video link

## Look at these first

### 1. One locked write path, with a concurrency token per row

Every requirement write (add, edit, approve, delete) goes through `write_requirements` in
[`screening/review/service.py`](apps/api/src/screening/review/service.py). It locks the job row
(`select … for update`) and applies the change. Then it stamps `jobs.updated_at` and clears the
job review (BR-2, BR-4), reads the full payload and commits, all in one transaction. Approving
the job takes the same lock.

- **Why:** what the recruiter saves is what candidates are screened against. Serialising the
  writes for one job means positions cannot collide, a delete can renumber safely, and approving
  the job cannot race an edit. Every write returns the whole job, so the client never has to
  re-derive side effects such as a cleared review or renumbered positions.
- **Lost updates:** PATCH and DELETE send the `updated_at` they read, and a mismatch is a 409
  `stale`. The value is written with `clock_timestamp()` rather than `now()`, because `now()` is
  fixed at transaction start. Under the lock, `clock_timestamp()` gives each write a strictly
  later value. Values are compared exactly and round-trip through JSON with microseconds, and
  the web client treats them as opaque strings, never parsing them into a `Date`.
- **Decided with me:** a PATCH that changes nothing is a no-op (no bump, review kept, 200).
  Approving an already reviewed job is an idempotent 200 that keeps the original reviewer.

### 2. No Save button: a save queue per requirement

Kind changes, approvals and deletes save immediately, and text saves on blur or Enter. The store
is [`lib/review/store.ts`](apps/web/lib/review/store.ts): a pure reducer with a small external
store around it.

- Each requirement has its own promise queue. Requests for one row go out one at a time, and
  each uses the token from the previous response, so a slow earlier response cannot overwrite a
  later edit. Different rows do not block each other.
- A server payload replaces the server state, but rows with a draft in progress keep the draft.
  A payload older than the one held (by `jobs.updated_at`) is ignored.
- The reducer sits in an external store read with `useSyncExternalStore`, not in `useReducer`.
  The queue has to read the latest token synchronously, and a ref mirror of React state lags a
  commit, which would send stale tokens.
- I used no data-fetching library: the ordering and draft rules are custom, and a cache library
  would fight them.
- The browser's leave-page warning is armed while the add form has text, a row has an unsaved or
  invalid draft, a request is in flight, or a save failed. With none of these, everything on
  screen is already in the DB.

### 3. Failures never lose or hide data

- **Network error or 5xx on a text save:** the text stays in the input, and the row shows
  "Not saved · Retry". A sticky snackbar offers Retry, and nothing is rolled back silently.
- **Network error on a kind change, approve or delete:** the row reverts to the server state,
  and a snackbar offers Retry.
- **409 `stale`:** "This requirement was changed elsewhere", with Reload. Reload refetches the
  job, drops that row's draft so it shows the other tab's version, and keeps drafts on every
  other row.
- **Duplicate text (409) and validation (422):** shown inline on the row or the add form. The
  text is kept, and nothing is retried.
- **Approve job** is disabled while any of its conditions fail, and the reason is shown as text
  next to the button: fewer than 3 requirements, any unapproved, any save pending or failed, or
  any input invalid. The API enforces the same rules (409 `too_few_requirements` /
  `not_all_approved`).

All of this was checked end to end in JR-13 (see "How it was verified").

## Other choices

- **API tests run against the real Docker Postgres.** Each test runs inside an outer transaction
  that is rolled back, and the app session joins it with
  `join_transaction_mode="create_savepoint"`. Locks, deferred constraints and check constraints
  behave as in production, and no test data is left behind.
  - Each request gets its own session on the test's connection, so an API rollback never undoes
    a test's setup.
  - `just check` therefore needs `docker compose up -d`.
  - The tests assume the seed as loaded. If the database has been written to, for example by
    using the app, the run stops up front and asks for `just reset`.
- **Reviewer identity** is an `X-Reviewer-Name` header, required on writes only. The web app
  sends one constant name. The header stands in for sign-in, and the endpoints stay the same
  when sign-in arrives.
- **Approving the job does not touch `jobs.updated_at`.** "Last change" means the last change to
  the requirements.
- **Duplicate text is an API check only.** There is no unique index on
  `(job_id, lower(btrim(text)))`. The plan recommended one as a safety net; I decided against it.
- **UI:** shadcn/ui (Radix, Tailwind v4) with Sonner snackbars and lucide icons, and dark mode
  follows the OS.

## Schema changes (`db/01-schema.sql`)

Why the schema changed, per the spec (§4):

- **`jobs.updated_at`, `reviewed_at`, `reviewed_by`**, plus a check that the last two are both
  set or both null. The page shows when the requirements last changed and who approved the job.
  Any later requirement write must clear the approval, so it needs its own columns.
- **`requirements.created_at`, `updated_at`, `updated_by`, `reviewed_at`.** `reviewed_at` is the
  approval of one requirement. `updated_at` doubles as the concurrency token (see choice 1).
- **`unique (job_id, position) deferrable initially deferred`** replaces the plain
  `requirements_job_position_idx`. Positions must stay unique and contiguous. Deferring the check
  to commit lets a delete shift the rows after it up by one in the same transaction.

## How it was verified

- **Automated:** `just check` runs lint, format and type checks plus 88 API tests (on the real
  DB) and 92 web tests (with `fetch` stubbed). It passes on `main`.
- **End-to-end (JR-13):**
  - **Setup:** headless Chrome drove the real stack against a freshly reset DB, and `psql`
    queries after each step checked that the DB matched the screen.
  - **Use cases:** UC1 to UC9 all passed. A kind-only change keeps `extracted`; a text edit flips
    it to `edited`; an edit on an approved row keeps it approved; an added row is last, approved
    and `added`; approving the job sets the reviewer; any later write clears the review.
  - **Drills:** the API down during a text save, a kind change and a delete; two tabs editing
    the same row (409 stale, then Reload); duplicate text from the add form and from a row;
    approving the job with 2 rows (from the UI and against the API); leaving the page with a row
    draft, add-form text, a failed save, a request in flight, and with everything saved (no
    warning). All passed, and no fix was needed.
  - **Caveat:** the "API down" drills cut the requests in the browser (network abort or 500)
    rather than stopping the API process.

## How I worked with AI

Starting from the spec ([job-review.md](docs/features/job-review.md)), I had Claude Code split
the work into tasks with dependencies and just-in-time gates in
[job-review.plan.md](docs/features/job-review.plan.md).

- **Gates:** each gate sits at the point in the work where it matters. A `clarify` gate means
  ask me before building that path. A `destructive` gate means get my OK before a DB reset. A
  `verify` gate means check the framework docs before relying on them.
- **The atlas:** a shared board (a claude.ai artifact with a small database) held task status,
  open questions with a recommendation, decisions and the time log. Every session read it before
  starting and wrote back when it stopped.
- **Parallel sessions:** an API lane and a web lane ran as separate Claude Code sessions, each in
  its own git worktree. Each opened a stacked PR per task. The web lane built against the
  contract in the spec with `fetch` stubbed and was first run against the real API in JR-13.
- **The gate:** `just check` is enforced by a stop hook, so a session cannot finish with lint,
  types or tests failing.

The chats are in [`ai-sessions/`](ai-sessions/).

## Next steps

With more time:

- **E2E tests in CI.** Turn the JR-13 run (Playwright against the real stack) into a checked-in
  suite, including a real "API process down" drill.
- **Keep the "changed after review" note across reloads.** Today the note "Changes made after
  review. Approve the job again." shows only in the session that cleared the review. After a
  reload the job just reads "Not reviewed". Storing when and why the review was cleared would
  fix that.
- **Small UI polish:**
  - The selected kind in the segmented switch has low contrast.
  - Snackbars are one per requirement, so a newer failure on a row replaces the older one's
    Retry. The older change was already reverted, so nothing is hidden, but a recruiter may
    expect both.
- **Duplicate-text index.** Add the DB unique index as a safety net under the API check.

In production:

- **Real sign-in** in place of `X-Reviewer-Name`, with the reviewer taken from the session.
- **Audit history:** who changed which requirement, from what, to what. Candidates are screened
  against this data, so "why does this job require X?" needs an answer.
- **Screen only against reviewed jobs, and against a snapshot.** Freeze the approved requirement
  set as a version, so candidates screened before a later edit stay comparable, and an
  unreviewed job is never used for screening.
- **Migrations** (Alembic) instead of editing `01-schema.sql` and resetting the database.
- **Reordering requirements and a job list**, both left out of scope here.

Dev note: after `pnpm install` brings new packages, restart `just dev`. A running Next dev
server keeps a failed module resolution in memory and serves 500 until restarted.
