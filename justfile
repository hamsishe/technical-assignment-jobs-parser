# Run `just` on its own to see this list.
default:
    @just --list

# Install everything. Run this once.
setup:
    docker compose up -d
    uv sync --project apps/api
    pnpm install
    @echo ""
    @echo "Setup done. Now run: just dev"

# Start the database, the API and the web app together. Ctrl-C stops all of it.
dev:
    docker compose up -d
    pnpm exec concurrently --kill-others --names "api,web" --prefix-colors "cyan,magenta" \
        "uv run --project apps/api uvicorn screening.main:app --reload --port 8000" \
        "pnpm --filter web dev"

# Throw the database away and load the seed data again.
reset:
    docker compose down -v
    docker compose up -d

# Stop the database.
stop:
    docker compose down

# Open a psql prompt against the seeded database.
psql:
    docker compose exec db psql -U app -d screening

# Lint, format check and type check both apps.
lint:
    uv run --project apps/api ruff check apps/api
    uv run --project apps/api ruff format --check apps/api
    pnpm --filter web lint
    pnpm --filter web typecheck

# Apply safe lint fixes and formatting.
fix:
    uv run --project apps/api ruff check --fix apps/api
    uv run --project apps/api ruff format apps/api
    pnpm --filter web exec eslint . --fix

# Run both test suites.
test:
    uv run --project apps/api pytest apps/api
    pnpm --filter web test

# The gate: must pass before a change is done or committed.
check: lint test
