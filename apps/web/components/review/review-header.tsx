import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/review/format";
import type { Job } from "@/lib/review/types";

/** Sticky header: title, location, review status and the last change (spec §6). */
export function ReviewHeader({ job }: { job: Job }) {
  return (
    <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80">
      <div className="mx-auto flex max-w-3xl flex-col gap-1 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold">
            {job.title} <span className="font-normal text-muted-foreground">· {job.location}</span>
          </h1>
          <ReviewStatus job={job} />
        </div>
        <p className="text-sm text-muted-foreground">
          {job.updated_at === null
            ? "No changes yet"
            : `Last change ${formatDateTime(job.updated_at)}`}
        </p>
      </div>
    </header>
  );
}

function ReviewStatus({ job }: { job: Job }) {
  if (job.reviewed_at === null) {
    return <Badge variant="secondary">Not reviewed</Badge>;
  }
  return (
    <Badge className="bg-green-600 text-white dark:bg-green-700">
      Reviewed by {job.reviewed_by} · {formatDateTime(job.reviewed_at)}
    </Badge>
  );
}
