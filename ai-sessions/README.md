# AI sessions

Full Claude Code chats used to build the Job Review feature, one file per session.

| Session | Worked on |
| ------- | --------- |
| Planning | Spec → execution plan (JR-0), the atlas, CLAUDE.md pointer |
| Session A (worktree `ta-api`) | JR-1 to JR-6: schema, test harness, all API endpoints |
| Session B (worktree `ta-web-ui`) | JR-15: Tailwind + shadcn/ui setup |
| Session C (worktree `ta-web-client`) | JR-7: web API client and types |
| Session D (worktree `ta-web`) | JR-8 to JR-12: review page, save engine, row editing, add/approve, leave guard |
| Session E (main checkout) | JR-13 end-to-end run with failure drills, JR-14 delivery notes |
| Others | Dev tooling (ruff, eslint, `just check`, stop hook), the spec, API test cleanup (PR #17) |

The task board these sessions shared (status, decisions, time log) is described in
[`../NOTES.md`](../NOTES.md#how-i-worked-with-ai) and
[`../docs/features/job-review.plan.md`](../docs/features/job-review.plan.md).

TODO: export each session (`/export` in Claude Code) into this folder before zipping.
