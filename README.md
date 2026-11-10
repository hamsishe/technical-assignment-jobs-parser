# Technical Check-in

Thanks for the conversations so far. This is a small slice of the work you would do
here. It is not a full product.

**Time: plan for about 1 to 1.5 hours of building.** We do not stop you there. How
long you take is up to you. Tell us in `NOTES.md` how long you spent. Setup and the
video do not count. A small thing done well beats a big thing done in a rush.

## Setup

You need Docker, [uv](https://docs.astral.sh/uv/), [pnpm](https://pnpm.io/) and
[just](https://just.systems/). Then:

```bash
just setup     # start the database, install Python and Node dependencies
just dev       # run the database, the API and the web app together
```

Ports 3000, 8000 and 55432 must be free. Open [http://localhost:3000](http://localhost:3000).
You should see three green dots: web app, API, database. That page only proves the
stack is up. Ctrl-C stops everything.

`just` lists the other recipes. `just reset` loads the seed data again. If you would
rather not install `just`, run the commands from the `justfile` yourself.

## What you get

A running stack and some data. No application code.

```
apps/api/                     Python API: FastAPI, SQLAlchemy, Pydantic
  src/screening/main.py         GET /health, and nothing else
  src/screening/db.py           async engine, one session per request
apps/web/                     Next.js app: TypeScript, React
  app/page.tsx                  the status page
  next.config.ts                /api/* is passed through to the API
db/01-schema.sql              the tables, with a note on each column
db/02-seed.sql                the fake data
data/*.json                   the same data as JSON, to read without psql
```

| Piece    | Where                                          |
| -------- | ---------------------------------------------- |
| Web      | [http://localhost:3000](http://localhost:3000) |
| API      | [http://localhost:8000](http://localhost:8000) |
| Database | `postgres://app:app@localhost:55432/screening` |

Stay in this stack. It is what you would work in here.

## The task

A machine reads a job description and pulls out its requirements. It gets things
wrong. A recruiter reviews the list before it is used: fixes wrong text or importance,
removes what should not be there, and adds what is missing. What they save is what
every candidate for that job is screened against.

Build that review, the screen and the API, for one job. Three jobs are seeded and no
human has reviewed them yet. Start with `22222222-2222-4222-8222-222222222222`.

The rest is your call: what the screen shows, how editing and saving work, what happens
when something fails, and what you test. Skip sign-in, a job list and the extraction.

## What we look at

This is a full-stack role. The API and the screen count the same.

- **Judgment:** what you chose to build, what you left out, and why
- **Does it work:** what you built behaves the way you say it does, including when
  things go wrong. The data a recruiter saves is the data candidates are screened
  against, so it must be right.
- **The code:** someone new can read it and change it safely, on both sides
- **How you work with AI**, if you use it

## What to send

Within 7 days of getting this task, zip the whole repo and reply to the email you got
it from, with the zip attached. Besides your code, make sure the repo has:

- **Its `.git` folder.** Commit as you go. Your first and last commits show when you
  started and stopped.
- **`ai-sessions/`**, if you used AI. AI is fine, we use it every day. Add the full
  chats, not a summary.
- **`NOTES.md`**, with:
   - how long you spent building
   - a link to a video of up to 10 minutes: show it working, and walk us through one
     choice you made
   - the choices you want us to look at first, and why you made them
   - what you would do next with more time, or in production

## Next step

We book a call and go through your choices together.
