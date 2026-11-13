"use client";

import { RotateCwIcon, SearchXIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, getJob } from "@/lib/review/api";
import { rowState, saveStatus, visibleRequirements } from "@/lib/review/store";
import type { Job } from "@/lib/review/types";

import { RequirementRow } from "./requirement-row";
import { ReviewHeader } from "./review-header";
import { useReviewStore } from "./use-review-store";

type LoadState =
  | { status: "loading" }
  | { status: "not_found" }
  | { status: "failed"; message: string }
  | { status: "ready"; job: Job };

/** The review page for one job: loads it, then shows header, description and rows. */
export function JobReview({ jobId }: { jobId: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getJob(jobId, { signal: controller.signal }).then(
      (job) => setState({ status: "ready", job }),
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState(
          isNotFound(error)
            ? { status: "not_found" }
            : { status: "failed", message: errorMessage(error) },
        );
      },
    );
    return () => controller.abort();
  }, [jobId, attempt]);

  function retry() {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }

  switch (state.status) {
    case "loading":
      return <LoadingPage />;
    case "not_found":
      return (
        <PageMessage>
          <Alert>
            <SearchXIcon aria-hidden />
            <AlertTitle>Job not found</AlertTitle>
            <AlertDescription>There is no job with this link. Check the address.</AlertDescription>
          </Alert>
        </PageMessage>
      );
    case "failed":
      return (
        <PageMessage>
          <Alert variant="destructive">
            <TriangleAlertIcon aria-hidden />
            <AlertTitle>Couldn&apos;t load the job</AlertTitle>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
          <Button className="mt-4" onClick={retry}>
            <RotateCwIcon aria-hidden data-icon="inline-start" />
            Retry
          </Button>
        </PageMessage>
      );
    case "ready":
      return <ReviewPage initialJob={state.job} />;
  }
}

function ReviewPage({ initialJob }: { initialJob: Job }) {
  const [state, store] = useReviewStore(initialJob);
  const { job } = state;
  const requirements = visibleRequirements(state);
  const approved = requirements.filter((r) => r.approved).length;
  const progress = `${approved} of ${requirements.length} approved`;

  return (
    <div className="flex min-h-svh flex-col">
      <ReviewHeader job={job} saveStatus={saveStatus(state)} />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6">
        <section aria-label="Job description">
          <p className="leading-relaxed whitespace-pre-line">{job.description}</p>
        </section>

        <section aria-labelledby="requirements-heading" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="requirements-heading" className="font-semibold">
              Requirements
            </h2>
            <p className="text-sm text-muted-foreground">{progress}</p>
          </div>
          <ol className="flex flex-col gap-3">
            {requirements.map((requirement) => (
              <li key={requirement.id}>
                <RequirementRow
                  requirement={requirement}
                  row={rowState(state, requirement.id)}
                  actions={store}
                />
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="sticky bottom-0 border-t bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80">
        <div className="mx-auto flex max-w-3xl items-center justify-end gap-3 px-4 py-3">
          <p className="text-sm">{progress}</p>
        </div>
      </footer>
    </div>
  );
}

function LoadingPage() {
  return (
    <div role="status" aria-busy="true" className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
      <span className="sr-only">Loading job…</span>
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-20 w-full" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

function PageMessage({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-xl px-4 py-16">{children}</main>;
}

// A malformed id gets a 422 from the API: it cannot match a job either, and retrying
// will not help, so it is shown as "not found" too.
function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 422);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
