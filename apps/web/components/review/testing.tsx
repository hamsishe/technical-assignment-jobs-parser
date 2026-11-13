// Test-only helpers for rendering the review page against a stubbed API.
// Imported by *.test.tsx files only.

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { Toaster } from "@/components/ui/sonner";
import { JOB_ID, jsonResponse } from "@/lib/review/test-fixtures";
import type { Job } from "@/lib/review/types";

import { JobReview } from "./job-review";

/** Renders the page against a stubbed API: GET returns `job`, then each write gets the next answer. */
export async function renderReview(job: Job, ...answers: Array<Response | Error>) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(job));
  for (const answer of answers) {
    if (answer instanceof Error) fetchMock.mockRejectedValueOnce(answer);
    else fetchMock.mockResolvedValueOnce(answer);
  }
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  render(
    <>
      <JobReview jobId={JOB_ID} />
      <Toaster />
    </>,
  );
  await screen.findByRole("banner");

  const writes = () =>
    fetchMock.mock.calls.slice(1).map(([url, init]) => ({
      url: String(url),
      method: init?.method,
      headers: new Headers(init?.headers),
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    }));
  return { user, fetchMock, writes };
}

export const row = (n: number) => screen.getByRole("group", { name: `Requirement ${n}` });
export const textbox = (n: number) =>
  within(row(n)).getByRole("textbox", { name: "Requirement text" });
export const saveStatus = () => screen.getByRole("status", { name: "Save status" });
export const offline = () => new TypeError("Failed to fetch");
