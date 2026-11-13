import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import {
  JOB_ID,
  errorResponse,
  jsonResponse,
  makeJob,
  makeRequirement,
} from "@/lib/review/test-fixtures";

import { JobReview } from "./job-review";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

test("renders the header, the description, the rows in order, origin tags and quote warnings", async () => {
  const job = makeJob({
    updated_at: "2026-11-13T12:02:03.123456Z",
    // Sent out of order on purpose: the page orders rows by position.
    requirements: [
      makeRequirement({
        position: 3,
        text: "Current CPR and BLS certification",
        origin: "added",
        source_quote: null,
        reviewed_at: "2026-11-13T12:02:03.123456Z",
      }),
      makeRequirement({
        position: 1,
        text: "Active RN licence",
        origin: "extracted",
        source_quote: "hiring registered nurses",
      }),
      makeRequirement({
        position: 2,
        text: "Two years of long term care experience",
        origin: "edited",
        kind: "nice_to_have",
        source_quote: "experience in long term care",
      }),
    ],
  });
  const fetchMock = stubFetch(jsonResponse(job));

  render(<JobReview jobId={JOB_ID} />);

  const header = await screen.findByRole("banner");
  expect(within(header).getByRole("heading", { level: 1 })).toHaveTextContent(
    "Registered Nurse - Long Term Care · Toronto, ON",
  );
  expect(within(header).getByText("Not reviewed")).toBeInTheDocument();
  expect(within(header).getByText(/^Last change 13 Nov 2026, \d\d:\d\d$/)).toBeInTheDocument();

  const main = screen.getByRole("main");
  expect(within(main).getByText(job.description)).toBeInTheDocument();

  const rows = within(main).getAllByRole("group", { name: /^Requirement \d$/ });
  expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
    "Requirement 1",
    "Requirement 2",
    "Requirement 3",
  ]);
  const [first, second, third] = rows;

  // Unapproved rows show the text in an input with the quote below.
  expect(within(first).getByRole("textbox", { name: "Requirement text" })).toHaveValue(
    "Active RN licence",
  );
  expect(within(first).getByText("extracted")).toBeInTheDocument();
  expect(within(first).getByText("“hiring registered nurses”")).toBeInTheDocument();
  expect(within(first).getByRole("radio", { name: "Must have" })).toBeChecked();

  expect(within(second).getByText("edited")).toBeInTheDocument();
  expect(within(second).getByRole("radio", { name: "Nice to have" })).toBeChecked();

  // Approved rows show plain text and the ✓ badge; a null quote shows the warning.
  expect(within(third).queryByRole("textbox")).not.toBeInTheDocument();
  expect(within(third).getByText("Current CPR and BLS certification")).toBeInTheDocument();
  expect(within(third).getByText("Approved")).toBeInTheDocument();
  expect(within(third).getByText("added")).toBeInTheDocument();
  expect(within(third).getByText("Not found in the job description")).toBeInTheDocument();
  expect(within(first).queryByText("Not found in the job description")).not.toBeInTheDocument();

  expect(within(screen.getByRole("contentinfo")).getByText("1 of 3 approved")).toBeInTheDocument();

  // Opening the page writes nothing (UC1).
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls[0][0]).toBe(`/api/jobs/${JOB_ID}`);
  expect(fetchMock.mock.calls[0][1]?.method).toBe("GET");
});

test("shows 'No changes yet' for an untouched job", async () => {
  stubFetch(jsonResponse(makeJob({ updated_at: null })));

  render(<JobReview jobId={JOB_ID} />);

  expect(await screen.findByText("No changes yet")).toBeInTheDocument();
});

test("shows who reviewed the job and when", async () => {
  stubFetch(
    jsonResponse(
      makeJob({
        updated_at: "2026-11-12T10:00:00Z",
        reviewed_at: "2026-11-13T12:30:00Z",
        reviewed_by: "Dana",
      }),
    ),
  );

  render(<JobReview jobId={JOB_ID} />);

  const header = await screen.findByRole("banner");
  expect(within(header).getByText(/^Reviewed by Dana · 13 Nov 2026, \d\d:\d\d$/)).toBeInTheDocument();
  expect(within(header).queryByText("Not reviewed")).not.toBeInTheDocument();
});

test("shows a loading state until the job arrives", async () => {
  let resolve: (response: Response) => void = () => {};
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(() => new Promise((r) => (resolve = r))),
  );

  render(<JobReview jobId={JOB_ID} />);

  expect(screen.getByRole("status")).toHaveTextContent("Loading job…");
  resolve(jsonResponse(makeJob()));
  expect(await screen.findByRole("banner")).toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

test("shows 'Job not found' on 404", async () => {
  stubFetch(errorResponse(404, "not_found", "Job not found."));

  render(<JobReview jobId={JOB_ID} />);

  expect(await screen.findByText("Job not found")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
});

test("shows a full-page error on other failures, and Retry loads the job", async () => {
  const user = userEvent.setup();
  const fetchMock = stubFetch(new Response("Bad gateway", { status: 502 }), jsonResponse(makeJob()));

  render(<JobReview jobId={JOB_ID} />);

  expect(await screen.findByText("Couldn't load the job")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry" }));

  expect(await screen.findByRole("banner")).toBeInTheDocument();
  expect(screen.queryByText("Couldn't load the job")).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("shows a full-page error when the network is down", async () => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch")));

  render(<JobReview jobId={JOB_ID} />);

  expect(await screen.findByText("Couldn't reach the server.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
});
