#!/usr/bin/env bash
# Stop hook: when apps/ has uncommitted changes, run `just check`.
# On failure, exit 2 so Claude keeps working on the errors instead of stopping.
# After 3 failed attempts in a row, it lets Claude stop so it can report to the user.
set -uo pipefail

input=$(cat)
session=$(jq -r '.session_id // "default"' <<<"$input")
root=$(git rev-parse --show-toplevel)
cd "$root"

[[ -z $(git status --porcelain -- apps) ]] && exit 0

counter="${TMPDIR:-/tmp}/claude-gate-${session}"
if output=$(just check 2>&1); then
  rm -f "$counter"
  exit 0
fi

attempts=$(( $(cat "$counter" 2>/dev/null || echo 0) + 1 ))
echo "$attempts" > "$counter"
if (( attempts >= 3 )); then
  rm -f "$counter"
  echo "Gate still failing after 3 attempts; stopping. Report the failure to the user." >&2
  exit 0
fi

{
  echo "Gate failed (just check). Fix the errors below, then finish again."
  echo "$output" | tail -n 60
} >&2
exit 2
