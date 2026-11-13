# Job Review: execution plan

Spec: [job-review.md](job-review.md). This file defines **what** each task is. **Live status,
open questions and time spent live in the atlas, not here:**

> **Atlas:** <https://claude.ai/artifact/Rktd7N1KwFZ1k9zzxRy9qi>
>
> Sessions read and write it with the `ArtifactData` tool (collections `tasks`, `decisions`,
> `log`; document ids are the task and decision ids, e.g. `tasks/JR-4`, `decisions/Q1`). The
> page shows the same data to people. Every write to an existing document needs `if_version`
> from your last read: read the document, then `update` it pinned to that version. If the pin
> fails, someone else changed it: re-read and redo.

## Session protocol

1. **Before starting:** read `tasks` and `decisions` in the atlas. Pick a task whose status is
   `todo` and whose `depends_on` are all `done`. Set it to `in_progress` with `owner` = a short
   session label and `updated_at` = now. Never take a task someone else holds.
2. **JIT gates:** each task lists just-in-time steps. Do each one at the point it is needed, not
   up front. `clarify` gates name a decision in `decisions`: if it is still `open`, ask the user
   (offer the recommendation), then write the answer into the decision and set it `decided`.
   `destructive` gates need the user's explicit OK in this session. Tick each JIT item in the
   atlas as you clear it.
3. **While working:** follow `CLAUDE.md` (tests with every change, `just check`). Add a `log`
   entry for anything another session needs to know (a contract change, a surprise, a blocker).
   Blocked → status `blocked` and say why in `notes`.
4. **When done:** PR open → `in_review` with `pr`. Merged → `done`, add `minutes` spent. The
   final task rolls minutes and decisions into `NOTES.md`.

Branches follow `CLAUDE.md`, using the task id as the ticket:
`<type>/petro-rudenko/JR-<n>-<short-desc>`, PR title `<type>(<scope>): [JR-<n>] <summary>`.

## Parallel sessions

Each session works in its own git worktree next to the main checkout (e.g.
`../ta-api`), so sessions never switch branches under each other.

- Install with `uv sync --project apps/api && pnpm install`. **Never `just setup` in a
  worktree.** Docker names the compose project after the folder, so it would try to start a
  second database on port 55432.
- All worktrees share the one database. Only the db/api lane resets it, and from its own
  worktree as `COMPOSE_PROJECT_NAME=technical-assignment just reset`. That recreates the shared
  database from that worktree's `db/*.sql`. Tell the other sessions in the atlas log first: API
  tests in other worktrees fail while it restarts.
- `just check` runs both apps' tests in every worktree, so every worktree needs both installs
  and the database up.
- Ports 3000 and 8000 are shared. Only one session runs `just dev` at a time.

## Lanes and order

```text
db/api lane:  JR-1 ─► JR-2 ─► JR-3 ─┬─► JR-4 ─┐
                                    ├─► JR-5 ─┼─────────────► JR-13 ─► JR-14
                                    └─► JR-6 ─┘                 ▲
web lane:     JR-7 ──┬─► JR-8 ─► JR-9 ─► JR-10 ─► JR-11 ─► JR-12 ┘
              JR-15 ─┘
```

JR-15 (shadcn/ui setup) was added after the first plan and keeps its id; it comes before JR-8.

The web lane does not wait for the API: its tests stub `fetch` against the contract in spec §5.
JR-4/5/6 can run in parallel but all add routes to the same module; doing them in sequence is
simpler and costs little.

## Decisions

Recorded in the atlas `decisions` collection. Defaults already taken (status `decided`):

| Id | Decision | Why |
| -- | -------- | --- |
| D1 | Write `updated_at` with `clock_timestamp()`, not `now()`. | `now()` is the transaction start. Under the job lock, `clock_timestamp()` gives each write on a job a strictly later token (BR-12). |
| D2 | API tests run against the Docker DB. Each test runs in an outer transaction that is rolled back; the session uses `join_transaction_mode="create_savepoint"` so app commits stay inside it. | Real Postgres behaviour (locks, deferrable unique, check constraints) with no leftover data. `just check` needs `docker compose up -d`. |
| D3 | API: SQLAlchemy 2.0 typed ORM models for the two tables, explicit `select … for update` / bulk `update` statements for locking and renumbering, Pydantic v2 schemas, code in `screening/review/`. | Readable models; the tricky writes stay visible as SQL. |
| D4 | Web: no data-fetching library. One `useReducer` store plus a per-requirement promise queue. | The per-row ordering and draft rules are custom; a cache library would fight them. |
| D5 | Web UI: **shadcn/ui** (Radix primitives + Tailwind CSS v4), components generated into `apps/web/components/ui/`, icons from `lucide-react`, toasts via shadcn's Sonner. No hand-rolled CSS for things a shadcn component covers. Dates via `Intl.DateTimeFormat`. See the component map under JR-15. Radix base, `radix-nova` style; dark mode follows `prefers-color-scheme`. | User requirement. Accessible primitives (toggle group, buttons, inputs with `aria-invalid` styling) out of the box. |
| D6 | `X-Reviewer-Name` is required on writes only. | GET is not a write (BR-13). |
| D7 | Approving the job does not touch `jobs.updated_at`. | BR-2 counts requirement writes only. |

Open (status `open`, asked at the JIT gate of the task named):

| Id | Question | Recommendation | Gate |
| -- | -------- | -------------- | ---- |
| Q1 | A PATCH that changes nothing (same text, same kind, approving an approved row): is it a write? | No-op: no `updated_at` bump, no review clear, return 200 with the current payload. | JR-4 |
| Q2 | `POST /review` on a job that is already reviewed? | 200, idempotent, keeps the original `reviewed_at`/`reviewed_by`. | JR-6 |
| Q3 | Also enforce BR-10 in the DB with a unique index on `(job_id, lower(btrim(text)))`? | Yes, as a safety net under the app check (the app check gives the 409 message). | JR-1 |
| Q4 | Approve clicked while the text input holds an invalid draft? | Approve is disabled for that row; the inline error explains why. | JR-10 |
| Q5 | 409 `stale` → **Reload**: what is reloaded? | Refetch the job; drop that row's draft; keep drafts on other rows. | JR-10 |

## Tasks

Each task: branch, what it delivers, JIT gates, done-when. Every task ends with `just check`
green and a log entry with minutes.

### JR-1 · db · Review schema and test harness

Branch `feat/petro-rudenko/JR-1-review-schema`. Depends on: none.

- Edit `db/01-schema.sql` per spec §4: job review columns plus the both-or-neither check;
  requirement `created_at`, `updated_at`, `updated_by`, `reviewed_at`; replace
  `requirements_job_position_idx` with `unique (job_id, position) deferrable initially deferred`.
- Add `apps/api/tests/conftest.py`: rollback-isolated session fixture (D2), override of
  `get_session`, an `AsyncClient` fixture, seed job ids as constants.
- Schema tests: seed loads with contiguous positions; `reviewed_at` without `reviewed_by` is
  rejected; positions can be shifted within one transaction.
- `NOTES.md`: reason for the schema change.

JIT:

- `clarify` Q3 (duplicate-text index) before writing the schema.
- `destructive` Reset wipes the local DB. Confirm with the user, log it in the atlas, then run
  `COMPOSE_PROJECT_NAME=technical-assignment just reset` from this worktree (see Parallel
  sessions).
- `verify` After reset, `just psql` → `\d requirements` shows the new constraint.

Done when: schema tests pass against a freshly reset DB.

### JR-2 · api · GET job

Branch `feat/petro-rudenko/JR-2-get-job`. Depends on: JR-1.

- `screening/review/`: ORM models, Pydantic job payload (spec §5 shape), `load_job_payload()`,
  error helper producing `{detail: {code, message}}`, router included in `main.py`.
- `GET /jobs/{job_id}` → 200 payload with requirements in `position` order; 404 `not_found`;
  a malformed UUID → 422.

JIT:

- `verify` Confirm FastAPI serialises `timestamptz` with microseconds and offset, and that the
  same string parses back for the `expected_updated_at` comparison (D1 relies on exact equality).

Done when: GET tests from spec §7 pass.

### JR-3 · api · Add requirement and the write transaction

Branch `feat/petro-rudenko/JR-3-add-requirement`. Depends on: JR-2.

- `reviewer_name` dependency: `X-Reviewer-Name`, trimmed, 1–100 chars, else 422.
- One write-transaction helper used by every write: lock the job (`for update`, 404 if missing),
  run the change, set `jobs.updated_at`, clear `reviewed_at`/`reviewed_by` (BR-2, BR-4), commit,
  return the payload. JR-4/5/6 reuse it.
- Text validation shared by POST and PATCH: trim, 1–500 chars (BR-5). Duplicate check,
  case-insensitive and trimmed (BR-10) → 409 `duplicate_text`.
- `POST /jobs/{job_id}/requirements` → 201: origin `added`, position `max+1`, approved,
  `updated_by` from the header.

Done when: POST tests from spec §7 pass, including the `jobs.updated_at` bump and a cleared
review.

### JR-4 · api · Edit and approve requirement

Branch `feat/petro-rudenko/JR-4-patch-requirement`. Depends on: JR-3.

- `PATCH /jobs/{job_id}/requirements/{id}` with `extra="forbid"`, at least one of
  `text`/`kind`/`approved`, required `expected_updated_at`.
- Requirement of another job → 404. Stale token → 409 `stale` (BR-12).
- Origin rules (BR-6), approval rules (BR-8), same-text no-op.

JIT:

- `clarify` Q1 (no-op PATCH) before writing the no-op branch.

Done when: PATCH tests from spec §7 pass, plus the Q1 behaviour.

### JR-5 · api · Delete requirement

Branch `feat/petro-rudenko/JR-5-delete-requirement`. Depends on: JR-3.

- `DELETE /jobs/{job_id}/requirements/{id}?expected_updated_at=…` → 200 payload.
- Shift later positions up by one in the same transaction (deferrable unique, BR-7).
- Stale → 409; another job's requirement → 404; allowed below 3 rows.

Done when: DELETE tests from spec §7 pass; a test deletes from the middle and checks 1..n.

### JR-6 · api · Approve job

Branch `feat/petro-rudenko/JR-6-approve-job`. Depends on: JR-3.

- `POST /jobs/{job_id}/review`: under the job lock, 409 `too_few_requirements` (< 3) or
  `not_all_approved`; else set `reviewed_at`/`reviewed_by` (BR-3, BR-9). No `updated_at` bump (D7).

JIT:

- `clarify` Q2 (already reviewed) before writing the handler.

Done when: review tests from spec §7 pass, including "a later write clears both" for each write
type that exists by then.

### JR-7 · web · API client and types

Branch `feat/petro-rudenko/JR-7-web-api-client`. Depends on: none (contract from spec §5).

- `lib/review/types.ts` (Job, Requirement, Kind, Origin, error codes), `lib/review/api.ts`
  (`getJob`, `addRequirement`, `patchRequirement`, `deleteRequirement`, `approveJob`), an
  `ApiError` with `status`, `code`, `message`, and a network-error kind distinct from HTTP errors.
- `REVIEWER_NAME` constant; every write sends `X-Reviewer-Name`. `expected_updated_at` is URL
  encoded on DELETE (the `+` in an offset breaks otherwise).

JIT:

- `install` `pnpm --filter web add -D @testing-library/user-event` (typing, blur, Enter, Escape
  in later tests). Commit the lockfile with it.
- `verify` Read `apps/web/node_modules/next/dist/docs` on client components and fetch before
  writing code that Next touches.

Done when: client tests pass (header on every write, error parsing, encoding).

### JR-15 · web · shadcn/ui setup

Branch `chore/petro-rudenko/JR-15-shadcn-setup`. Depends on: none. Can run in parallel with
JR-7 (they touch different files except `package.json` and the lockfile, so merge one first).

- Tailwind CSS v4 + shadcn/ui in `apps/web`: `components.json`, `lib/utils.ts` (`cn`),
  PostCSS config, shadcn theme tokens in `app/globals.css`.
- Add the components the screen needs (map below) into `components/ui/`.
- Move the status page (`app/page.tsx`) off its old CSS variables. `--muted` and `--line` clash
  with shadcn's tokens (shadcn's `--muted` is a background colour, so the status text would go
  near-invisible). Use Tailwind classes such as `text-muted-foreground`, `border-border`,
  `text-destructive`.
- Mount `<Toaster />` once in `app/layout.tsx`.
- Generated files must pass `just check` as they are: fix lint or type errors at the source, do
  not add disables.

Component map (the web tasks use these, not custom equivalents):

| Spec element | shadcn component | Note |
| ------------ | ---------------- | ---- |
| Kind switch (Must have / Nice to have) | `ToggleGroup type="single"` | Radix lets the user deselect, giving `""`: ignore an empty value so one kind is always selected. Items have role `radio` in tests. |
| Origin tag (grey / green / yellow) | `Badge` | Add `extracted`/`edited`/`added` variants with `cva` in our own wrapper, not by editing `ui/badge.tsx`. |
| Review status, "✓ Approved" | `Badge` | |
| Requirement text, add-form text | `Input` | Set `aria-invalid` for the red border and link the message with `aria-describedby`. |
| Approve, Edit, Delete / Confirm delete, Add, Approve job, Retry | `Button` | Icons from `lucide-react`. Destructive variant for "Confirm delete". |
| Requirement row, add form | `Card` | |
| Snackbars | `Sonner` (`toast`) | Errors: `duration: Infinity`, `closeButton`, `action` for Retry/Reload. No success toasts (spec). |
| Full-page load error, "Job not found" | `Alert` | |
| Loading | `Skeleton` | |

The disabled reason for Approve job is shown as text next to the button, not in a tooltip:
disabled buttons get no hover events, and the spec says "with the reason shown".

JIT:

- `verify` Read the current shadcn install guide for Next.js (ui.shadcn.com/docs/installation/next)
  and confirm it supports Next 16, React 19 and Tailwind v4. Read the CSS/PostCSS page in
  `apps/web/node_modules/next/dist/docs`. If they disagree with this plan, log it and ask.
- `install` From `apps/web`: `pnpm dlx shadcn@latest init -b radix --preset nova`. Since July
  2026 the bare `init` uses Base UI, not Radix; the user kept Radix (D5). Check it installed
  into `apps/web`, not the workspace root.
- `install` `pnpm dlx shadcn@latest add button input badge card toggle-group sonner alert skeleton`.
  Check what extra packages it pulls in (e.g. the Sonner wrapper imports `next-themes`). Keep them
  or simplify the wrapper, and say which in the PR.
- `verify` Radix needs browser APIs jsdom lacks (`ResizeObserver`, pointer capture,
  `matchMedia`). Add only the polyfills a failing test asks for to `vitest.setup.ts`.
- `verify` `just dev`: the status page at `/` still shows its three dots with readable text in
  light and dark.

Done when: `just check` passes, the status page test still passes, and a small test renders the
kind `ToggleGroup` and checks that clicking the selected item does not deselect it.

### JR-8 · web · Review page, read-only

Branch `feat/petro-rudenko/JR-8-review-page`. Depends on: JR-7, JR-15.

- Build with the shadcn components from the JR-15 map.
- Route `app/jobs/[jobId]/page.tsx` rendering a client `JobReview` component.
- Loading state; 404 "Job not found"; other load failure → full-page error with Retry.
- Sticky header (title, location, status, last change or "No changes yet"), description,
  requirement rows (kind switch display, origin tag colours, quote or "⚠ Not found in the job
  description"), footer progress "N of M approved".

JIT:

- `verify` Check the Next 16 docs for dynamic route `params` (a Promise in recent Next) before
  writing the route file.

Done when: the render test from spec §7 (first web bullet) passes.

### JR-9 · web · Save engine

Branch `feat/petro-rudenko/JR-9-save-engine`. Depends on: JR-8.

- Store: server job, per-row drafts, per-row status (`idle`, `saving`, `failed`, `invalid`).
- Per-requirement serial queue: one request at a time, each using the `updated_at` from the
  previous response. A successful payload replaces server state; rows with a draft keep it.
- Header save status ("Saving…", "All changes saved", "N changes not saved"); snackbars via
  Sonner `toast` (errors stay until dismissed, Retry/Reload actions). Wrap `toast` in one small
  module so tests can assert on calls.
- A derived `hasUnsavedWork` flag for JR-11 and JR-12.

Done when: tests show two quick edits to one row go out in order with the second using the
first's token, and that a payload refresh keeps another row's draft.

### JR-10 · web · Requirement row interactions

Branch `feat/petro-rudenko/JR-10-row-editing`. Depends on: JR-9.

- Components per the JR-15 map (`ToggleGroup`, `Input` with `aria-invalid`, `Button`, `Badge`).
- Kind switch: optimistic PATCH, revert plus snackbar on failure.
- Text: save on blur/Enter if changed and valid; Escape restores; empty or > 500 → red border,
  inline message, no request.
- Approve (with the pending valid text in the same PATCH), approved row read-only with ✓ and
  Edit; a saved edit returns to read-only and stays approved; a failed or invalid edit stays in
  edit mode.
- Delete with two-click inline confirm.
- Errors: network/5xx on text → "Not saved · Retry"; 409 `stale` → snackbar with Reload; 409
  `duplicate_text` and 422 inline on the row.

JIT:

- `clarify` Q4 (approve with invalid draft) and Q5 (what Reload reloads) before building those
  paths.

Done when: the row tests from spec §7 pass.

### JR-11 · web · Add form and approve job

Branch `feat/petro-rudenko/JR-11-add-and-approve`. Depends on: JR-10.

- Add form: kind switch (default Must have), input, Add; Enter submits; disabled when empty;
  clears only on success.
- Approve job (header and footer): disabled with the reason shown while < 3 rows, any
  unapproved, any save pending/failed, or any input invalid. Reviewed status "Reviewed by X ·
  date"; after a later change "Not reviewed" plus "Changes made after review. Approve the job
  again."

Done when: the add and approve-job tests from spec §7 pass.

### JR-12 · web · Leave-page guard

Branch `feat/petro-rudenko/JR-12-leave-guard`. Depends on: JR-11.

- `beforeunload` armed while the add form has text, a row has an unsaved or invalid draft, a
  request is in flight, or a save failed.

Done when: tests show the handler is armed for add-form text and for a failed save, and not
armed when everything is saved.

### JR-13 · verify · End-to-end run

Branch: none unless fixes are needed (then `fix/petro-rudenko/JR-13-<desc>`). Depends on: JR-4,
JR-5, JR-6, JR-12.

- `just reset`, `just dev`, open `/jobs/22222222-2222-4222-8222-222222222222`.
- Walk UC1–UC9. Failure drills: stop the API mid-edit (Not saved · Retry), two tabs editing the
  same row (409 stale), duplicate text, approve job with < 3 rows, close the tab with a draft.
- After each drill, check the DB with `just psql` matches what the screen says.

JIT:

- `destructive` `just reset` again: confirm with the user.

Done when: every UC and drill behaves as the spec says, or a fix task is logged.

### JR-14 · docs · Delivery

Branch `docs/petro-rudenko/JR-14-delivery-notes`. Depends on: JR-13.

- `NOTES.md`: total time (sum of atlas minutes), the choices to look at first (from
  `decisions`), what comes next.
- `ai-sessions/`: full chat exports.
- Final `just check` on `main`.

JIT:

- `clarify` Ask the user for the video link and for any choices they want to lead with.

Done when: README "What to send" checklist is met, except the zip and the email, which the
user does.
