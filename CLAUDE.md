# CLAUDE.md

Requirements review tool: a recruiter corrects machine-extracted job requirements, and candidates are screened against what they save. Data correctness comes first. Task and setup: `README.md`.

## Layout

- `apps/api`: FastAPI (uv). Run with `uv run --project apps/api ...`.
- `apps/web`: Next.js 16 (pnpm). Run with `pnpm --filter web ...`. For framework APIs, check `apps/web/node_modules/next/dist/docs` before relying on older knowledge.
- `db/*.sql`: source of truth for the schema and column meanings. Changes need `just reset` (wipes data) and a reason in `NOTES.md`.

## Conventions

- Web calls the API through `/api/*` (Next rewrite), never `localhost:8000`.
- DB sessions come from `get_session` in `apps/api/src/screening/db.py`.
- Every behavior change ships with a test. API: `apps/api/tests`, via `httpx.AsyncClient` + `ASGITransport`. Web: `*.test.tsx` next to the code, with `fetch` stubbed.
- Keep `NOTES.md` current: time spent, key choices and why, next steps.

## Gate

`just check` (lint, types, tests for both apps) must pass before work is done or committed. Run `just fix` for auto-fixable issues.

- Fix the cause. No `noqa`, `eslint-disable`, `@ts-ignore` or skipped tests unless unavoidable, and then with a comment explaining why.
- A Stop hook enforces the gate. If it lets you stop with the gate still failing, report that to the user. Never say the work is done.

## Git

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`. Scopes: `api`, `web`, `db`; omit for repo-wide changes.

- Branch: `<type>/<engineer>/<ticket>-<short-desc>`. Engineer is `git config user.name` in kebab-case; omit `<ticket>-` if there is none.
- Commit: `<type>(<scope>): <summary>`. The summary is short, plain and imperative, e.g. `fix(api): reject duplicate positions`. One logical change per commit.
- PR title: `<type>(<scope>): [<ticket>] <summary>`. Include scope and ticket whenever they exist; the ticket comes from the branch name.
- PR body: what changed, why, and how it was verified.
