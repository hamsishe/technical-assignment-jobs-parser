import { type MockInstance, afterEach, beforeEach, expect, test, vi } from "vitest";

import { notify } from "./notify";
import {
  compareTimestamps,
  createReviewStore,
  hasUnsavedWork,
  rowState,
  rowStatus,
  saveStatus,
  validateText,
} from "./store";
import {
  JOB_ID,
  errorResponse,
  jsonResponse,
  makeJob,
  makeRequirement,
  withChange as written,
} from "./test-fixtures";

const T0 = "2026-11-13T10:00:00Z";
const T1 = "2026-11-13T10:00:01.000001Z";
const T2 = "2026-11-13T10:00:02.5Z";
const T3 = "2026-11-13T10:00:03Z";

let notifyError: MockInstance<typeof notify.error>;

beforeEach(() => {
  notifyError = vi.spyOn(notify, "error").mockImplementation(() => {});
  vi.spyOn(notify, "dismiss").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Deferred = { resolve: (response: Response) => void; reject: (error: unknown) => void };

/** A fetch stub whose calls stay pending until the test answers them, in any order. */
function controlledFetch() {
  const pending: Deferred[] = [];
  const fetchMock = vi.fn<typeof fetch>(
    () =>
      new Promise<Response>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    respond: (index: number, response: Response) => pending[index].resolve(response),
    fail: (index: number) => pending[index].reject(new TypeError("Failed to fetch")),
    body: (index: number) => JSON.parse(String(fetchMock.mock.calls[index][1]?.body)),
  };
}

function setup() {
  const a = makeRequirement({ position: 1, text: "Alpha", updated_at: T0 });
  const b = makeRequirement({ position: 2, text: "Beta", updated_at: T0 });
  const job = makeJob({ updated_at: T0, requirements: [a, b] });
  return { a, b, job, store: createReviewStore(job) };
}

const settle = () => vi.waitFor(() => Promise.resolve());

test("two quick edits to one row go out in order, the second with the first's token", async () => {
  const { a, job, store } = setup();
  const api = controlledFetch();

  store.setDraft(a.id, "Alpha 2");
  store.saveText(a.id);
  store.setDraft(a.id, "Alpha 3");
  store.saveText(a.id);

  await settle();
  // The second request waits for the first: one at a time per requirement.
  expect(api.fetchMock).toHaveBeenCalledOnce();
  expect(api.body(0)).toEqual({ text: "Alpha 2", expected_updated_at: T0 });
  expect(rowStatus(rowState(store.getState(), a.id))).toBe("saving");

  const afterFirst = written(job, T1, a.id, { text: "Alpha 2", origin: "edited" });
  api.respond(0, jsonResponse(afterFirst));

  await vi.waitFor(() => expect(api.fetchMock).toHaveBeenCalledTimes(2));
  expect(api.body(1)).toEqual({ text: "Alpha 3", expected_updated_at: T1 });
  // The user is still ahead of the server: the draft stays until its own save lands.
  expect(rowState(store.getState(), a.id).draft).toBe("Alpha 3");

  api.respond(1, jsonResponse(written(afterFirst, T2, a.id, { text: "Alpha 3" })));

  await vi.waitFor(() => expect(saveStatus(store.getState())).toEqual({ kind: "saved" }));
  const state = store.getState();
  expect(state.job.requirements[0]).toMatchObject({ text: "Alpha 3", updated_at: T2 });
  expect(rowState(state, a.id).draft).toBeNull();
  expect(hasUnsavedWork(state)).toBe(false);
});

test("a payload refresh keeps another row's draft", async () => {
  const { a, b, job, store } = setup();
  const api = controlledFetch();

  store.setDraft(b.id, "Beta, still typing");
  store.setDraft(a.id, "Alpha 2");
  store.saveText(a.id);
  await settle();
  api.respond(0, jsonResponse(written(job, T1, a.id, { text: "Alpha 2" })));

  await vi.waitFor(() => expect(rowState(store.getState(), a.id).draft).toBeNull());
  const state = store.getState();
  expect(state.job.requirements[0].text).toBe("Alpha 2");
  expect(state.job.requirements[1].text).toBe("Beta");
  expect(rowState(state, b.id).draft).toBe("Beta, still typing");
  expect(hasUnsavedWork(state)).toBe(true);
});

test("an older payload arriving late does not roll back a newer one", async () => {
  const { a, b, job, store } = setup();
  const api = controlledFetch();

  store.setDraft(a.id, "Alpha 2");
  store.saveText(a.id);
  store.setDraft(b.id, "Beta 2");
  store.saveText(b.id);
  await settle();
  expect(api.fetchMock).toHaveBeenCalledTimes(2);

  // The server ran A's write first (T1), then B's (T2), but B's answer arrives first.
  const afterA = written(job, T1, a.id, { text: "Alpha 2" });
  const afterB = written(afterA, T2, b.id, { text: "Beta 2" });
  api.respond(1, jsonResponse(afterB));
  await vi.waitFor(() => expect(store.getState().job.updated_at).toBe(T2));
  api.respond(0, jsonResponse(afterA));

  await vi.waitFor(() => expect(saveStatus(store.getState())).toEqual({ kind: "saved" }));
  expect(store.getState().job).toEqual(afterB);
});

test("an invalid draft sends nothing and marks the row invalid", () => {
  const { a, store } = setup();
  const api = controlledFetch();

  store.setDraft(a.id, "   ");
  store.saveText(a.id);

  expect(api.fetchMock).not.toHaveBeenCalled();
  const row = rowState(store.getState(), a.id);
  expect(rowStatus(row)).toBe("invalid");
  expect(row.error).toBe("Enter the requirement text.");
  expect(saveStatus(store.getState())).toEqual({ kind: "unsaved", count: 1 });
  expect(hasUnsavedWork(store.getState())).toBe(true);

  // The message follows the input once shown.
  store.setDraft(a.id, "Alpha fixed");
  expect(rowState(store.getState(), a.id).error).toBeNull();
});

test("unchanged text after trimming sends nothing and drops the draft", () => {
  const { a, store } = setup();
  const api = controlledFetch();

  store.setDraft(a.id, "  Alpha  ");
  store.saveText(a.id);

  expect(api.fetchMock).not.toHaveBeenCalled();
  expect(rowState(store.getState(), a.id).draft).toBeNull();
  expect(hasUnsavedWork(store.getState())).toBe(false);
});

test("typing back to the saved text is not a draft", () => {
  const { a, store } = setup();

  store.setDraft(a.id, "Alph");
  store.setDraft(a.id, "Alpha");

  expect(rowState(store.getState(), a.id).draft).toBeNull();
});

test("a network failure keeps the text, offers Retry, and the retry saves it", async () => {
  const { a, job, store } = setup();
  const api = controlledFetch();

  store.setDraft(a.id, "Alpha 2");
  store.saveText(a.id);
  await settle();
  api.fail(0);

  await vi.waitFor(() => expect(rowStatus(rowState(store.getState(), a.id))).toBe("failed"));
  expect(rowState(store.getState(), a.id).draft).toBe("Alpha 2");
  expect(saveStatus(store.getState())).toEqual({ kind: "unsaved", count: 1 });
  expect(hasUnsavedWork(store.getState())).toBe(true);
  expect(notifyError).toHaveBeenCalledExactlyOnceWith(
    "Couldn't save. Check your connection.",
    expect.objectContaining({ action: expect.objectContaining({ label: "Retry" }) }),
  );

  notifyError.mock.calls[0][1]?.action?.onClick();
  await settle();
  expect(api.body(1)).toEqual({ text: "Alpha 2", expected_updated_at: T0 });
  api.respond(1, jsonResponse(written(job, T1, a.id, { text: "Alpha 2" })));

  await vi.waitFor(() => expect(rowStatus(rowState(store.getState(), a.id))).toBe("idle"));
  expect(rowState(store.getState(), a.id).draft).toBeNull();
  expect(notify.dismiss).toHaveBeenCalled();
});

test("a 5xx counts as a network failure", async () => {
  const { a, store } = setup();
  const api = controlledFetch();

  store.setDraft(a.id, "Alpha 2");
  store.saveText(a.id);
  await settle();
  api.respond(0, new Response("Bad gateway", { status: 502 }));

  await vi.waitFor(() => expect(rowState(store.getState(), a.id).failure).toBe("transient"));
});

test("409 stale keeps the draft and offers Reload, which refetches the job", async () => {
  const { a, job, store } = setup();
  const api = controlledFetch();

  store.setDraft(a.id, "Alpha 2");
  store.saveText(a.id);
  await settle();
  api.respond(0, errorResponse(409, "stale", "Changed elsewhere."));

  await vi.waitFor(() => expect(rowState(store.getState(), a.id).failure).toBe("stale"));
  expect(rowState(store.getState(), a.id).draft).toBe("Alpha 2");
  expect(notifyError).toHaveBeenCalledExactlyOnceWith(
    "This requirement was changed elsewhere",
    expect.objectContaining({ action: expect.objectContaining({ label: "Reload" }) }),
  );

  notifyError.mock.calls[0][1]?.action?.onClick();
  await settle();
  expect(api.fetchMock.mock.calls[1][1]?.method).toBe("GET");
  const elsewhere = written(job, T3, a.id, { text: "Alpha from another tab" });
  api.respond(1, jsonResponse(elsewhere));

  await vi.waitFor(() => expect(store.getState().job).toEqual(elsewhere));
  expect(rowState(store.getState(), a.id).failure).toBeNull();
});

test("409 duplicate_text is shown on the row, not as a snackbar", async () => {
  const { a, store } = setup();
  const api = controlledFetch();

  store.setDraft(a.id, "Beta");
  store.saveText(a.id);
  await settle();
  api.respond(0, errorResponse(409, "duplicate_text", "This requirement is already in the list."));

  await vi.waitFor(() => expect(rowStatus(rowState(store.getState(), a.id))).toBe("invalid"));
  expect(rowState(store.getState(), a.id).error).toBe("This requirement is already in the list.");
  expect(notifyError).not.toHaveBeenCalled();
});

test("notifies subscribers on every change", () => {
  const { a, store } = setup();
  const listener = vi.fn();
  const unsubscribe = store.subscribe(listener);

  store.setDraft(a.id, "Alpha 2");
  unsubscribe();
  store.setDraft(a.id, "Alpha 3");

  expect(listener).toHaveBeenCalledOnce();
});

test("validateText applies BR-5 to the trimmed text, counting characters", () => {
  expect(validateText("ok")).toBeNull();
  expect(validateText(" \t ")).toBe("Enter the requirement text.");
  expect(validateText("x".repeat(500))).toBeNull();
  expect(validateText(` ${"x".repeat(500)} `)).toBeNull();
  expect(validateText("x".repeat(501))).toBe("Use at most 500 characters (now 501).");
  // 500 emoji are 1000 UTF-16 units but 500 characters, as the API counts them.
  expect(validateText("😀".repeat(500))).toBeNull();
});

test("compareTimestamps orders microsecond timestamps exactly", () => {
  expect(compareTimestamps(T0, T1)).toBe(-1);
  expect(compareTimestamps(T2, T1)).toBe(1);
  // The API omits a zero fraction; plain string order would get this one wrong.
  expect(compareTimestamps("2026-11-13T10:00:00Z", "2026-11-13T10:00:00.5Z")).toBe(-1);
  expect(compareTimestamps("2026-11-13T10:00:00.000001Z", "2026-11-13T10:00:00.000002Z")).toBe(-1);
  expect(compareTimestamps("2026-11-13T12:00:00+02:00", "2026-11-13T10:00:00Z")).toBe(0);
  expect(compareTimestamps(null, T0)).toBe(-1);
  expect(compareTimestamps(T0, null)).toBe(1);
  expect(compareTimestamps(null, null)).toBe(0);
});

test("a job id is part of every write path", async () => {
  const { a, store } = setup();
  const api = controlledFetch();

  store.setDraft(a.id, "Alpha 2");
  store.saveText(a.id);
  await settle();

  expect(api.fetchMock.mock.calls[0][0]).toBe(`/api/jobs/${JOB_ID}/requirements/${a.id}`);
  expect(api.fetchMock.mock.calls[0][1]?.method).toBe("PATCH");
});

test("a stale row does not resend on blur; it waits for Reload", async () => {
  const { a, store } = setup();
  const api = controlledFetch();

  store.setDraft(a.id, "Alpha 2");
  store.saveText(a.id);
  await settle();
  api.respond(0, errorResponse(409, "stale"));
  await vi.waitFor(() => expect(rowState(store.getState(), a.id).failure).toBe("stale"));

  store.saveText(a.id);
  await settle();

  expect(api.fetchMock).toHaveBeenCalledOnce();
  expect(rowState(store.getState(), a.id).draft).toBe("Alpha 2");
});
