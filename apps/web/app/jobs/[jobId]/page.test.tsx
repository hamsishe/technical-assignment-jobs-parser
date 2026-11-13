import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { JOB_ID, jsonResponse, makeJob } from "@/lib/review/test-fixtures";

import JobReviewPage from "./page";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("loads the job named in the route", async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(makeJob()));
  vi.stubGlobal("fetch", fetchMock);

  render(await JobReviewPage({ params: Promise.resolve({ jobId: JOB_ID }) }));

  expect(await screen.findByRole("banner")).toBeInTheDocument();
  expect(fetchMock.mock.calls[0][0]).toBe(`/api/jobs/${JOB_ID}`);
});
