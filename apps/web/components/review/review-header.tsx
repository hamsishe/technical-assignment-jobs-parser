import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/review/format";
import type { SaveStatus } from "@/lib/review/store";
import type { Job } from "@/lib/review/types";
import { cn } from "@/lib/utils";

type Props = {
  job: Job;
  saveStatus: SaveStatus;
  /** A write in this session cleared the review (BR-4). */
  reviewCleared?: boolean;
  /** The Approve job control. */
  action?: React.ReactNode;
};

/** Sticky header: title, location, review status, last change and save status (spec §6). */
export function ReviewHeader({ job, saveStatus, reviewCleared = false, action }: Props) {
  return (
    <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80">
      <div className="mx-auto flex max-w-3xl flex-col gap-1 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-lg font-semibold">
            {job.title} <span className="font-normal text-muted-foreground">· {job.location}</span>
          </h1>
          <ReviewStatus job={job} />
          {action !== undefined && <div className="ml-auto">{action}</div>}
        </div>
        <p className="text-sm text-muted-foreground">
          <span>
            {job.updated_at === null
              ? "No changes yet"
              : `Last change ${formatDateTime(job.updated_at)}`}
          </span>
          {" · "}
          <SaveStatusText status={saveStatus} />
        </p>
        {reviewCleared && job.reviewed_at === null && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Changes made after review. Approve the job again.
          </p>
        )}
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

function SaveStatusText({ status }: { status: SaveStatus }) {
  return (
    <span
      role="status"
      aria-label="Save status"
      className={cn(status.kind === "unsaved" && "font-medium text-destructive")}
    >
      {saveStatusText(status)}
    </span>
  );
}

export function saveStatusText(status: SaveStatus): string {
  switch (status.kind) {
    case "saving":
      return "Saving…";
    case "saved":
      return "All changes saved";
    case "unsaved":
      return status.count === 1 ? "1 change not saved" : `${status.count} changes not saved`;
  }
}
