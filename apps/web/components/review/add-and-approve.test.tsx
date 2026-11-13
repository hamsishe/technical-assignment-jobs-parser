import { screen, within } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, expect, test, vi } from "vitest";

import { REVIEWER_NAME } from "@/lib/review/api";
import {
  JOB_ID,
  errorResponse,
  jsonResponse,
  makeJob,
  makeRequirement,
  withChange,
} from "@/lib/review/test-fixtures";
import type { Job } from "@/lib/review/types";

import { offline, renderReview, row, saveStatus, textbox } from "./testing";

const T0 = "2026-11-13T10:00:00Z";
const T1 = "2026-11-13T10:00:01Z";
const T2 = "2026-11-13T10:00:02Z";

afterEach(() => {
  toast.dismiss();
  vi.unstubAllGlobals();
});

function jobWith(rows: Array<{ approved: boolean }>): Job {
  return makeJob({
    updated_at: T0,
    requirements: rows.map(({ approved }, i) =>
      makeRequirement({
        position: i + 1,
        text: `Requirement text ${i + 1}`,
        updated_at: T0,
        reviewed_at: approved ? T0 : null,
      }),
    ),
  });
}

function withAdded(job: Job, text: string, kind: "must_have" | "nice_to_have"): Job {
  const added = makeRequirement({
    position: job.requirements.length + 1,
    text,
    kind,
    origin: "added",
    source_quote: null,
    updated_at: T1,
    updated_by: REVIEWER_NAME,
    reviewed_at: T1,
  });
  return { ...job, updated_at: T1, requirements: [...job.requirements, added] };
}

const addForm = () => screen.getByRole("group", { name: "Add requirement" });
const addInput = () => within(addForm()).getByRole("textbox", { name: "New requirement" });
const addButton = () => within(addForm()).getByRole("button", { name: "Add" });
const header = () => screen.getByRole("banner");
const footer = () => screen.getByRole("contentinfo");
const approveJobIn = (region: HTMLElement) =>
  within(region).getByRole("button", { name: "Approve job" });

// ── Add form ────────────────────────────────────────────────────────────────

test("Add is disabled while the input is empty; Enter on empty marks it red", async () => {
  const { user, writes } = await renderReview(jobWith([{ approved: false }]));

  expect(addButton()).toBeDisabled();
  await user.type(addInput(), "   ");
  expect(addButton()).toBeDisabled();

  await user.keyboard("{Enter}");

  expect(writes()).toEqual([]);
  expect(addInput()).toHaveAttribute("aria-invalid", "true");
  expect(addInput()).toHaveAccessibleDescription("Enter the requirement text.");
});

test("Add posts the text and kind, shows the new row, and clears the form", async () => {
  const job = jobWith([{ approved: false }]);
  const { user, writes } = await renderReview(
    job,
    jsonResponse(withAdded(job, "Fluent French", "nice_to_have"), 201),
  );

  await user.click(within(addForm()).getByRole("radio", { name: "Nice to have" }));
  await user.type(addInput(), "  Fluent French ");
  await user.click(addButton());

  await vi.waitFor(() => expect(addInput()).toHaveValue(""));
  expect(writes()).toEqual([
    {
      url: `/api/jobs/${JOB_ID}/requirements`,
      method: "POST",
      headers: expect.any(Headers),
      body: { text: "Fluent French", kind: "nice_to_have" },
    },
  ]);
  expect(writes()[0].headers.get("X-Reviewer-Name")).toBe(REVIEWER_NAME);
  // Back to the default kind for the next one.
  expect(within(addForm()).getByRole("radio", { name: "Must have" })).toBeChecked();

  // Created approved, so it reads as plain text with the added tag.
  expect(within(row(2)).getByText("Fluent French")).toBeInTheDocument();
  expect(within(row(2)).getByText("added")).toBeInTheDocument();
  expect(within(row(2)).getByText("Approved")).toBeInTheDocument();
  expect(within(footer()).getByText("1 of 2 approved")).toBeInTheDocument();
});

test("Enter submits the add form", async () => {
  const job = jobWith([]);
  const { user, writes } = await renderReview(job, jsonResponse(withAdded(job, "BLS", "must_have"), 201));

  await user.type(addInput(), "BLS{Enter}");

  await vi.waitFor(() => expect(addInput()).toHaveValue(""));
  expect(writes()[0].body).toEqual({ text: "BLS", kind: "must_have" });
});

test("a failed add keeps the text and shows a snackbar", async () => {
  const { user } = await renderReview(jobWith([]), offline());

  await user.type(addInput(), "BLS{Enter}");

  expect(await screen.findByText("Couldn't add the requirement. Check your connection.")).toBeInTheDocument();
  expect(addInput()).toHaveValue("BLS");
  expect(addButton()).toBeEnabled();
});

test("a duplicate add keeps the text and shows the message on the form", async () => {
  const { user } = await renderReview(
    jobWith([{ approved: false }]),
    errorResponse(409, "duplicate_text", "This requirement is already in the list."),
  );

  await user.type(addInput(), "Requirement text 1{Enter}");

  await vi.waitFor(() =>
    expect(addInput()).toHaveAccessibleDescription("This requirement is already in the list."),
  );
  expect(addInput()).toHaveValue("Requirement text 1");
});

// ── Approve job ─────────────────────────────────────────────────────────────

test("Approve job is disabled with fewer than 3 requirements, with the reason shown", async () => {
  await renderReview(jobWith([{ approved: true }, { approved: true }]));

  for (const region of [header(), footer()]) {
    expect(approveJobIn(region)).toBeDisabled();
    expect(approveJobIn(region)).toHaveAccessibleDescription("Needs at least 3 requirements (has 2).");
  }
});

test("Approve job is disabled while any requirement is unapproved", async () => {
  await renderReview(jobWith([{ approved: true }, { approved: false }, { approved: false }]));

  expect(approveJobIn(header())).toBeDisabled();
  expect(approveJobIn(header())).toHaveAccessibleDescription("2 requirements are not approved yet.");
});

test("Approve job is disabled while a row's input is invalid", async () => {
  const { user } = await renderReview(
    jobWith([{ approved: true }, { approved: true }, { approved: true }]),
  );

  await user.click(within(row(1)).getByRole("button", { name: "Edit" }));
  await user.clear(textbox(1));
  await user.keyboard("{Enter}");

  expect(approveJobIn(footer())).toBeDisabled();
  expect(approveJobIn(footer())).toHaveAccessibleDescription("Fix the highlighted requirement first.");
});

test("Approve job posts, shows the reviewed status, and a later change shows 'Not reviewed' again", async () => {
  const job = jobWith([{ approved: true }, { approved: true }, { approved: true }]);
  const reviewed: Job = { ...job, reviewed_at: T1, reviewed_by: REVIEWER_NAME };
  const [first] = job.requirements;
  const { user, writes } = await renderReview(
    job,
    jsonResponse(reviewed),
    // BR-4: the server clears the review on the next requirement write.
    jsonResponse({ ...withChange(reviewed, T2, first.id, { kind: "nice_to_have" }), reviewed_at: null, reviewed_by: null }),
  );

  expect(approveJobIn(header())).toBeEnabled();
  await user.click(approveJobIn(footer()));

  await vi.waitFor(() =>
    expect(within(header()).getByText(new RegExp(`^Reviewed by ${REVIEWER_NAME} · `))).toBeInTheDocument(),
  );
  expect(writes()[0]).toMatchObject({ url: `/api/jobs/${JOB_ID}/review`, method: "POST" });
  expect(writes()[0].headers.get("X-Reviewer-Name")).toBe(REVIEWER_NAME);
  expect(approveJobIn(header())).toHaveAccessibleDescription("Already approved.");
  expect(screen.queryByText("Changes made after review. Approve the job again.")).not.toBeInTheDocument();

  await user.click(within(row(1)).getByRole("radio", { name: "Nice to have" }));

  await vi.waitFor(() => expect(within(header()).getByText("Not reviewed")).toBeInTheDocument());
  expect(within(header()).getByText("Changes made after review. Approve the job again.")).toBeInTheDocument();
  expect(approveJobIn(header())).toBeEnabled();
  expect(saveStatus()).toHaveTextContent("All changes saved");
});

test("a rejected Approve job shows the server's reason with Reload", async () => {
  const job = jobWith([{ approved: true }, { approved: true }, { approved: true }]);
  const { user } = await renderReview(
    job,
    errorResponse(409, "not_all_approved", "Every requirement must be approved first."),
  );

  await user.click(approveJobIn(header()));

  expect(await screen.findByText("Every requirement must be approved first.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  expect(within(header()).getByText("Not reviewed")).toBeInTheDocument();
});
