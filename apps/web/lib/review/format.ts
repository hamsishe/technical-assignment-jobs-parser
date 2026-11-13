// Display formatting for the review page. Display only: never feed these strings back to
// the API, and never round-trip `updated_at` through `Date` for a write (it is the
// exact-equality concurrency token, see types.ts).

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** "13 Nov 2026, 14:02" in the viewer's time zone. */
export function formatDateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso));
}
