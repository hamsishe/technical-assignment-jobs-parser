# Notes

## Time spent

Building time per task is tracked in the Job Review atlas and summed here at the end (JR-14).

## Schema changes (`db/01-schema.sql`)

Why the schema changed, per the Job Review spec (§4):

- **`jobs.updated_at`, `reviewed_at`, `reviewed_by`** + check that the last two are both set or
  both null. The page shows when the requirements last changed and who approved the job;
  approval must be cleared by any later requirement write, so it needs its own columns.
- **`requirements.created_at`, `updated_at`, `updated_by`, `reviewed_at`.** `reviewed_at` is
  per-requirement approval. `updated_at` doubles as the optimistic-concurrency token: a write
  sends back the value it read and is rejected with 409 if the row has moved on. Writes set it
  with `clock_timestamp()` (not `now()`, which is fixed at transaction start), so each write
  under the job lock gets a strictly later value.
- **`unique (job_id, position) deferrable initially deferred`** replaces the plain
  `requirements_job_position_idx`. Positions must stay unique and contiguous; deferring the check
  to commit lets a delete shift the rows after it up by one in the same transaction.
- **No DB index for duplicate text.** Duplicate requirement text within a job (case-insensitive,
  trimmed) is rejected by the API with a 409 `duplicate_text`; we chose not to add a matching
  unique index (atlas decision Q3).

## Key choices

- **API tests run against the real Docker Postgres**, each inside an outer transaction that is
  rolled back; the app session joins it with `join_transaction_mode="create_savepoint"`. Locks,
  deferred constraints and check constraints behave as in production, and no test data is left
  behind. `just check` therefore needs `docker compose up -d`. Each request gets its own session
  on the test's connection, so an API rollback never undoes a test's setup. The tests assume the
  seed as loaded; if the database has been written to (e.g. by using the app), the run stops up
  front and asks for `just reset`.
- **One write path.** Every requirement write goes through `write_requirements` in
  `screening/review/service.py`: lock the job row (`select … for update`), apply the change, stamp
  `jobs.updated_at` and clear the job review, read the payload, commit. Writes to one job are
  serialised, so positions cannot collide and approving the job cannot race an edit.
- **Optimistic concurrency on `requirements.updated_at`.** PATCH and DELETE send the value they
  read; a mismatch is 409 `stale`. Values are stamped with `clock_timestamp()` and compared
  exactly; they round-trip through JSON with microseconds intact.
- **Decided with the user:** a PATCH that changes nothing is a no-op (no bump, review kept, 200);
  approving an already reviewed job is an idempotent 200 that keeps the original reviewer;
  duplicate text is an API check only (no DB index).

## Next steps

Tracked in the atlas while the feature is built; summarised here in JR-14.
