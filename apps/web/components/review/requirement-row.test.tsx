import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, expect, test, vi } from "vitest";

import { Toaster } from "@/components/ui/sonner";
import { REVIEWER_NAME } from "@/lib/review/api";
import {
  JOB_ID,
  errorResponse,
  jsonResponse,
  makeJob,
  makeRequirement,
  withChange,
  withoutRequirement,
} from "@/lib/review/test-fixtures";
import type { Job } from "@/lib/review/types";

import { JobReview } from "./job-review";

const T0 = "2026-11-13T10:00:00Z";
const T1 = "2026-11-13T10:00:01.000001Z";
const T2 = "2026-11-13T10:00:02Z";

afterEach(() => {
  toast.dismiss();
  vi.unstubAllGlobals();
});

function makeReviewJob(): Job {
  return makeJob({
    updated_at: T0,
    requirements: [
      makeRequirement({ position: 1, text: "Active RN licence", updated_at: T0 }),
      makeRequirement({ position: 2, text: "CPR certification", updated_at: T0 }),
      makeRequirement({
        position: 3,
        text: "Night shifts",
        updated_at: T0,
        reviewed_at: T0,
        origin: "added",
      }),
    ],
  });
}

/** Renders the page against a stubbed API: GET returns `job`, then each write gets the next answer. */
async function renderReview(job: Job, ...answers: Array<Response | Error>) {
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

const row = (n: number) => screen.getByRole("group", { name: `Requirement ${n}` });
const textbox = (n: number) => within(row(n)).getByRole("textbox", { name: "Requirement text" });
const saveStatus = () => screen.getByRole("status", { name: "Save status" });
const offline = () => new TypeError("Failed to fetch");

test("blur with changed text sends a PATCH with the token and the reviewer header", async () => {
  const job = makeReviewJob();
  const [first] = job.requirements;
  const { user, writes } = await renderReview(
    job,
    jsonResponse(withChange(job, T1, first.id, { text: "Active RN licence (Ontario)", origin: "edited" })),
  );

  await user.type(textbox(1), " (Ontario)");
  await user.tab();

  await vi.waitFor(() => expect(within(row(1)).getByText("edited")).toBeInTheDocument());
  expect(writes()).toEqual([
    {
      url: `/api/jobs/${JOB_ID}/requirements/${first.id}`,
      method: "PATCH",
      headers: expect.any(Headers),
      body: { text: "Active RN licence (Ontario)", expected_updated_at: T0 },
    },
  ]);
  expect(writes()[0].headers.get("X-Reviewer-Name")).toBe(REVIEWER_NAME);
  expect(textbox(1)).toHaveValue("Active RN licence (Ontario)");
  expect(saveStatus()).toHaveTextContent("All changes saved");
});

test("unchanged text sends nothing", async () => {
  const { user, writes } = await renderReview(makeReviewJob());

  await user.click(textbox(1));
  await user.tab();
  await user.type(textbox(2), "x");
  await user.type(textbox(2), "{Backspace}");
  await user.tab();
  await user.type(textbox(1), "  {Enter}");

  expect(writes()).toEqual([]);
  expect(textbox(1)).toHaveValue("Active RN licence");
});

test("empty text turns red, sends nothing and blocks Approve (Q4)", async () => {
  const { user, writes } = await renderReview(makeReviewJob());

  await user.clear(textbox(1));
  await user.tab();

  expect(writes()).toEqual([]);
  expect(textbox(1)).toHaveAttribute("aria-invalid", "true");
  expect(textbox(1)).toHaveAccessibleDescription("Enter the requirement text.");
  expect(within(row(1)).getByRole("button", { name: "Approve" })).toBeDisabled();
  expect(saveStatus()).toHaveTextContent("1 change not saved");

  // Fixing the text clears the message and saves on the next blur.
  await user.type(textbox(1), "Active RN licence, Ontario");
  expect(textbox(1)).not.toHaveAttribute("aria-invalid");
  expect(within(row(1)).getByRole("button", { name: "Approve" })).toBeEnabled();
});

test("text over 500 characters turns red and sends nothing", async () => {
  const { user, writes } = await renderReview(makeReviewJob());

  await user.click(textbox(1));
  await user.paste("x".repeat(500));
  await user.keyboard("{Enter}");

  expect(writes()).toEqual([]);
  expect(textbox(1)).toHaveAccessibleDescription(/Use at most 500 characters/);
});

test("Enter saves and Escape restores the saved text", async () => {
  const job = makeReviewJob();
  const [first] = job.requirements;
  const { user, writes } = await renderReview(
    job,
    jsonResponse(withChange(job, T1, first.id, { text: "RN licence", origin: "edited" })),
  );

  await user.type(textbox(2), " and BLS{Escape}");
  expect(textbox(2)).toHaveValue("CPR certification");

  await user.clear(textbox(1));
  await user.type(textbox(1), "RN licence{Enter}");

  await vi.waitFor(() => expect(writes()).toHaveLength(1));
  expect(writes()[0].body).toEqual({ text: "RN licence", expected_updated_at: T0 });
});

test("the kind switch sends a PATCH right away", async () => {
  const job = makeReviewJob();
  const [first] = job.requirements;
  const { user, writes } = await renderReview(
    job,
    jsonResponse(withChange(job, T1, first.id, { kind: "nice_to_have" })),
  );

  await user.click(within(row(1)).getByRole("radio", { name: "Nice to have" }));

  expect(within(row(1)).getByRole("radio", { name: "Nice to have" })).toBeChecked();
  await vi.waitFor(() => expect(saveStatus()).toHaveTextContent("All changes saved"));
  expect(writes()[0].body).toEqual({ kind: "nice_to_have", expected_updated_at: T0 });
  expect(within(row(1)).getByText("extracted")).toBeInTheDocument();
});

test("a failed kind change reverts and shows a snackbar with Retry", async () => {
  const job = makeReviewJob();
  const [first] = job.requirements;
  const { user, writes } = await renderReview(
    job,
    offline(),
    jsonResponse(withChange(job, T1, first.id, { kind: "nice_to_have" })),
  );

  await user.click(within(row(1)).getByRole("radio", { name: "Nice to have" }));

  expect(await screen.findByText("Couldn't save. Check your connection.")).toBeInTheDocument();
  expect(within(row(1)).getByRole("radio", { name: "Must have" })).toBeChecked();

  await user.click(screen.getByRole("button", { name: "Retry" }));
  await vi.waitFor(() =>
    expect(within(row(1)).getByRole("radio", { name: "Nice to have" })).toBeChecked(),
  );
  expect(writes()).toHaveLength(2);
  expect(writes()[1].body).toEqual({ kind: "nice_to_have", expected_updated_at: T0 });
});

test("a failed text save keeps the text, shows 'Not saved · Retry', and the retry succeeds", async () => {
  const job = makeReviewJob();
  const [first] = job.requirements;
  const { user, writes } = await renderReview(
    job,
    new Response("Bad gateway", { status: 502 }),
    jsonResponse(withChange(job, T1, first.id, { text: "RN licence", origin: "edited" })),
  );

  await user.clear(textbox(1));
  await user.type(textbox(1), "RN licence");
  await user.tab();

  expect(await within(row(1)).findByText("Not saved")).toBeInTheDocument();
  expect(textbox(1)).toHaveValue("RN licence");
  expect(screen.getByText("Couldn't save. Check your connection.")).toBeInTheDocument();
  expect(saveStatus()).toHaveTextContent("1 change not saved");

  await user.click(within(row(1)).getByRole("button", { name: "Retry" }));

  await vi.waitFor(() => expect(within(row(1)).queryByText("Not saved")).not.toBeInTheDocument());
  expect(writes()[1].body).toEqual({ text: "RN licence", expected_updated_at: T0 });
  expect(textbox(1)).toHaveValue("RN licence");
  expect(saveStatus()).toHaveTextContent("All changes saved");
});

test("Approve makes the row read-only; Edit opens it; a saved edit returns to read-only, still approved", async () => {
  const job = makeReviewJob();
  const [first] = job.requirements;
  const approved = withChange(job, T1, first.id, { reviewed_at: T1 });
  const { user, writes } = await renderReview(
    job,
    jsonResponse(approved),
    jsonResponse(withChange(approved, T2, first.id, { text: "RN licence", origin: "edited" })),
  );

  await user.click(within(row(1)).getByRole("button", { name: "Approve" }));

  expect(within(row(1)).queryByRole("textbox")).not.toBeInTheDocument();
  expect(within(row(1)).getByText("Approved")).toBeInTheDocument();
  await vi.waitFor(() => expect(saveStatus()).toHaveTextContent("All changes saved"));
  expect(writes()[0].body).toEqual({ approved: true, expected_updated_at: T0 });
  expect(screen.getAllByText("2 of 3 approved")).not.toHaveLength(0);

  await user.click(within(row(1)).getByRole("button", { name: "Edit" }));
  expect(textbox(1)).toHaveFocus();
  await user.clear(textbox(1));
  await user.type(textbox(1), "RN licence{Enter}");

  await vi.waitFor(() => expect(within(row(1)).queryByRole("textbox")).not.toBeInTheDocument());
  expect(within(row(1)).getByText("RN licence")).toBeInTheDocument();
  expect(within(row(1)).getByText("Approved")).toBeInTheDocument();
  expect(writes()[1].body).toEqual({ text: "RN licence", expected_updated_at: T1 });
});

test("Approve sends the pending valid text in the same request", async () => {
  const job = makeReviewJob();
  const [first] = job.requirements;
  const { user, writes } = await renderReview(
    job,
    jsonResponse(withChange(job, T1, first.id, { text: "RN licence", reviewed_at: T1, origin: "edited" })),
  );

  await user.clear(textbox(1));
  await user.type(textbox(1), "RN licence");
  await user.click(within(row(1)).getByRole("button", { name: "Approve" }));

  await vi.waitFor(() => expect(saveStatus()).toHaveTextContent("All changes saved"));
  expect(writes()).toHaveLength(1);
  expect(writes()[0].body).toEqual({ approved: true, text: "RN licence", expected_updated_at: T0 });
  expect(within(row(1)).getByText("RN licence")).toBeInTheDocument();
});

test("an invalid edit of an approved row stays in edit mode", async () => {
  const { user, writes } = await renderReview(makeReviewJob());

  await user.click(within(row(3)).getByRole("button", { name: "Edit" }));
  await user.clear(textbox(3));
  await user.keyboard("{Enter}");

  expect(writes()).toEqual([]);
  expect(textbox(3)).toHaveAttribute("aria-invalid", "true");

  // Escape gives up the edit and returns to read-only.
  await user.keyboard("{Escape}");
  expect(within(row(3)).queryByRole("textbox")).not.toBeInTheDocument();
  expect(within(row(3)).getByText("Night shifts")).toBeInTheDocument();
});

test("a failed approve reverts the row and offers Retry", async () => {
  const { user } = await renderReview(makeReviewJob(), offline());

  await user.click(within(row(1)).getByRole("button", { name: "Approve" }));

  expect(await screen.findByText("Couldn't save. Check your connection.")).toBeInTheDocument();
  expect(textbox(1)).toHaveValue("Active RN licence");
  expect(within(row(1)).queryByText("Approved")).not.toBeInTheDocument();
});

test("Delete needs a second click to confirm", async () => {
  const job = makeReviewJob();
  const [first] = job.requirements;
  const { user, writes } = await renderReview(job, jsonResponse(withoutRequirement(job, T1, first.id)));

  await user.click(within(row(1)).getByRole("button", { name: "Delete" }));
  expect(writes()).toEqual([]);

  await user.click(within(row(1)).getByRole("button", { name: "Confirm delete" }));

  await vi.waitFor(() => expect(saveStatus()).toHaveTextContent("All changes saved"));
  expect(writes()).toEqual([
    {
      url: `/api/jobs/${JOB_ID}/requirements/${first.id}?expected_updated_at=${encodeURIComponent(T0)}`,
      method: "DELETE",
      headers: expect.any(Headers),
      body: undefined,
    },
  ]);
  expect(screen.queryByDisplayValue("Active RN licence")).not.toBeInTheDocument();
  expect(textbox(1)).toHaveValue("CPR certification");
});

test("moving away cancels a pending delete confirmation", async () => {
  const { user, writes } = await renderReview(makeReviewJob());

  await user.click(within(row(1)).getByRole("button", { name: "Delete" }));
  await user.tab();

  expect(within(row(1)).getByRole("button", { name: "Delete" })).toBeInTheDocument();
  expect(writes()).toEqual([]);
});

test("a failed delete brings the row back with a snackbar", async () => {
  const { user } = await renderReview(makeReviewJob(), offline());

  await user.click(within(row(1)).getByRole("button", { name: "Delete" }));
  await user.click(within(row(1)).getByRole("button", { name: "Confirm delete" }));

  expect(await screen.findByText("Couldn't save. Check your connection.")).toBeInTheDocument();
  expect(textbox(1)).toHaveValue("Active RN licence");
});

test("409 stale offers Reload, which shows the other version and keeps other rows' drafts (Q5)", async () => {
  const job = makeReviewJob();
  const [first] = job.requirements;
  const elsewhere = withChange(job, T2, first.id, { text: "Changed in another tab", origin: "edited" });
  const { user, writes } = await renderReview(
    job,
    errorResponse(409, "stale", "This requirement was changed by someone else."),
    jsonResponse(elsewhere),
  );

  // Row 2 holds a draft that never leaves: empty, so invalid (moving to row 1 sends nothing).
  await user.clear(textbox(2));
  await user.clear(textbox(1));
  await user.type(textbox(1), "My version");
  await user.keyboard("{Enter}");

  expect(await screen.findByText("This requirement was changed elsewhere")).toBeInTheDocument();
  expect(textbox(1)).toHaveValue("My version");
  expect(within(row(1)).getByText("Not saved · Changed elsewhere")).toBeInTheDocument();

  // The row offers Reload too; use the snackbar's.
  const snackbarReload = screen
    .getAllByRole("button", { name: "Reload" })
    .find((button) => !row(1).contains(button));
  await user.click(snackbarReload!);

  await vi.waitFor(() => expect(textbox(1)).toHaveValue("Changed in another tab"));
  expect(writes()[1].method).toBe("GET");
  expect(writes()).toHaveLength(2);
  expect(textbox(2)).toHaveValue("");
  expect(textbox(2)).toHaveAttribute("aria-invalid", "true");
  expect(within(row(1)).queryByText(/Not saved/)).not.toBeInTheDocument();
});

test("409 duplicate_text is shown on the row", async () => {
  const { user } = await renderReview(
    makeReviewJob(),
    errorResponse(409, "duplicate_text", "This requirement is already in the list."),
  );

  await user.clear(textbox(1));
  await user.type(textbox(1), "CPR certification");
  await user.tab();

  await vi.waitFor(() =>
    expect(textbox(1)).toHaveAccessibleDescription("This requirement is already in the list."),
  );
  expect(textbox(1)).toHaveValue("CPR certification");
  expect(screen.queryByText("This requirement was changed elsewhere")).not.toBeInTheDocument();
});
