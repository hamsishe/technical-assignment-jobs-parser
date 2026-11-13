// Client state for the review page (D4): one pure reducer over the server job plus
// per-row drafts and save status, and a per-requirement promise queue.
//
// The reducer runs inside a tiny external store (read with useSyncExternalStore) rather
// than React's useReducer, because the queue must read the latest `updated_at` token
// synchronously when the next request leaves. React state seen through a ref lags a
// commit, and a lagging token turns a chained edit into a 409.

import { ApiError, getJob, isTransient, patchRequirement } from "./api";
import { notify } from "./notify";
import type { Job, Requirement } from "./types";

export const MAX_TEXT_LENGTH = 500;

/** Why the last save of a row's text did not land (the row keeps its draft). */
export type RowFailure =
  /** Network error or 5xx: "Not saved · Retry". */
  | "transient"
  /** 409 stale or 404: someone else changed or deleted it. Cleared by a reload. */
  | "stale";

export interface RowState {
  /** Text in the input that is not saved yet; null when the input shows the server text. */
  draft: string | null;
  /** Inline message: an invalid draft or a server rejection (422, 409 duplicate_text). */
  error: string | null;
  failure: RowFailure | null;
  /** Requests queued or in flight for this row. */
  pending: number;
}

export type RowStatus = "idle" | "saving" | "failed" | "invalid";

export interface ReviewState {
  job: Job;
  rows: Readonly<Record<string, RowState>>;
}

export type Action =
  | { type: "payload"; job: Job }
  | { type: "draft"; id: string; text: string }
  | { type: "invalid"; id: string; message: string }
  | { type: "sent"; id: string }
  | { type: "saved"; id: string; job: Job; text?: string }
  | { type: "failed"; id: string; failure?: RowFailure; error?: string }
  | { type: "reloaded"; job: Job };

const EMPTY_ROW: RowState = { draft: null, error: null, failure: null, pending: 0 };

export function initialState(job: Job): ReviewState {
  return { job, rows: {} };
}

export function rowState(state: ReviewState, id: string): RowState {
  return state.rows[id] ?? EMPTY_ROW;
}

export function reduce(state: ReviewState, action: Action): ReviewState {
  switch (action.type) {
    case "payload":
      return { ...state, job: newer(state.job, action.job) };

    case "draft": {
      const row = rowState(state, action.id);
      const server = findRequirement(state.job, action.id);
      // Typing back to the saved text is not a draft, unless a save is still on its way
      // (then the server text is about to change, and this text must be sent too).
      const draft = server?.text === action.text && row.pending === 0 ? null : action.text;
      // Once a message is showing, keep it current as the user types.
      const error = row.error === null || draft === null ? null : validateText(draft);
      return withRow(state, action.id, { ...row, draft, error });
    }

    case "invalid":
      return withRow(state, action.id, { ...rowState(state, action.id), error: action.message });

    case "sent": {
      const row = rowState(state, action.id);
      return withRow(state, action.id, {
        ...row,
        error: null,
        failure: null,
        pending: row.pending + 1,
      });
    }

    case "saved": {
      const row = rowState(state, action.id);
      // The draft is done only if it still says what was saved; the user may have typed on.
      const draftSaved =
        action.text !== undefined && row.draft !== null && row.draft.trim() === action.text;
      const next = { ...state, job: newer(state.job, action.job) };
      return withRow(next, action.id, {
        ...row,
        draft: draftSaved ? null : row.draft,
        pending: row.pending - 1,
      });
    }

    case "failed": {
      const row = rowState(state, action.id);
      return withRow(state, action.id, {
        ...row,
        pending: row.pending - 1,
        failure: action.failure ?? row.failure,
        error: action.error ?? row.error,
      });
    }

    case "reloaded": {
      // A reload is the answer to "changed elsewhere": the conflict has been seen.
      const rows = Object.fromEntries(
        Object.entries(state.rows).map(([id, row]) => [
          id,
          row.failure === "stale" ? { ...row, failure: null } : row,
        ]),
      );
      return { job: newer(state.job, action.job), rows };
    }
  }
}

function withRow(state: ReviewState, id: string, row: RowState): ReviewState {
  return { ...state, rows: { ...state.rows, [id]: row } };
}

function findRequirement(job: Job, id: string): Requirement | undefined {
  return job.requirements.find((r) => r.id === id);
}

/**
 * Keep whichever payload is newer. Every write bumps `jobs.updated_at` under the job
 * lock (D1), so a payload with an older stamp was overtaken by one we already hold:
 * applying it would roll back another row's newer token. Equal stamps (approve job,
 * no-op PATCH) take the later arrival.
 */
function newer(current: Job, incoming: Job): Job {
  return compareTimestamps(incoming.updated_at, current.updated_at) >= 0 ? incoming : current;
}

const TIMESTAMP = /^(.*T\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d:\d\d)$/;

/**
 * Orders API timestamps exactly. The API sends microseconds and omits the fraction when
 * it is zero, so neither string order nor `Date` (milliseconds) is precise enough.
 * `null` (never changed) sorts first.
 */
export function compareTimestamps(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return Math.sign(toMicros(a) - toMicros(b));
}

function toMicros(iso: string): number {
  const match = TIMESTAMP.exec(iso);
  if (match === null) throw new Error(`Unexpected timestamp: ${iso}`);
  const [, seconds, fraction = "", zone] = match;
  return Date.parse(seconds + zone) * 1000 + Number(fraction.padEnd(6, "0"));
}

/** BR-5: trimmed, 1–500 characters. Returns the inline message, or null when valid. */
export function validateText(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return "Enter the requirement text.";
  // Count code points, as the API does, not UTF-16 units.
  const length = [...trimmed].length;
  if (length > MAX_TEXT_LENGTH) {
    return `Use at most ${MAX_TEXT_LENGTH} characters (now ${length}).`;
  }
  return null;
}

// ── Selectors ────────────────────────────────────────────────────────────────

export function rowStatus(row: RowState): RowStatus {
  if (row.error !== null) return "invalid";
  if (row.pending > 0) return "saving";
  if (row.failure !== null) return "failed";
  return "idle";
}

export type SaveStatus =
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "unsaved"; count: number };

/** Header save status: "Saving…" / "All changes saved" / "N changes not saved". */
export function saveStatus(state: ReviewState): SaveStatus {
  if (Object.values(state.rows).some((row) => row.pending > 0)) return { kind: "saving" };
  const count = currentRows(state).filter((row) => {
    const status = rowStatus(row);
    return status === "failed" || status === "invalid";
  }).length;
  return count > 0 ? { kind: "unsaved", count } : { kind: "saved" };
}

/**
 * Something would be lost by leaving now: a draft, an invalid input, a failed save or a
 * request still in flight. The add form's text is tracked by the form itself.
 */
export function hasUnsavedWork(state: ReviewState): boolean {
  return (
    Object.values(state.rows).some((row) => row.pending > 0) ||
    currentRows(state).some((row) => row.draft !== null || row.failure !== null || row.error !== null)
  );
}

/** Row state for requirements that still exist (a row deleted elsewhere has nothing to save). */
function currentRows(state: ReviewState): RowState[] {
  return state.job.requirements.map((r) => rowState(state, r.id));
}

// ── Store ────────────────────────────────────────────────────────────────────

export type ReviewStore = ReturnType<typeof createReviewStore>;

export function createReviewStore(initialJob: Job) {
  const jobId = initialJob.id;
  let state = initialState(initialJob);
  const listeners = new Set<() => void>();
  const queues = new Map<string, Promise<void>>();

  function dispatch(action: Action) {
    state = reduce(state, action);
    for (const listener of listeners) listener();
  }

  /**
   * Run `request` after every earlier request for the same requirement has settled, with
   * the token current at that moment: the previous response's, or a newer payload's.
   */
  function enqueue(id: string, request: (token: string) => Promise<Job>, savedText?: string) {
    dispatch({ type: "sent", id });
    const previous = queues.get(id) ?? Promise.resolve();
    const current = previous.then(async () => {
      const token = findRequirement(state.job, id)?.updated_at;
      if (token === undefined) {
        // Deleted, here or elsewhere, while this request waited its turn.
        fail(id, new ApiError(404, "not_found", "This requirement no longer exists."));
        return;
      }
      try {
        const job = await request(token);
        dispatch({ type: "saved", id, job, text: savedText });
        notify.dismiss(toastId(id));
      } catch (error) {
        fail(id, error);
      }
    });
    queues.set(id, current);
    void current.then(() => {
      if (queues.get(id) === current) queues.delete(id);
    });
  }

  function fail(id: string, error: unknown) {
    if (isTransient(error)) {
      dispatch({ type: "failed", id, failure: "transient" });
      notify.error("Couldn't save. Check your connection.", {
        id: toastId(id),
        action: { label: "Retry", onClick: () => store.saveText(id) },
      });
    } else if (error instanceof ApiError && (error.code === "stale" || error.code === "not_found")) {
      dispatch({ type: "failed", id, failure: "stale" });
      notify.error("This requirement was changed elsewhere", {
        id: toastId(id),
        action: { label: "Reload", onClick: () => void store.reload() },
      });
    } else {
      // A business rule or validation answer (409 duplicate_text, 422): shown on the row.
      const message = error instanceof Error ? error.message : "Couldn't save.";
      dispatch({ type: "failed", id, error: message });
    }
  }

  const store = {
    getState: () => state,

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    setDraft(id: string, text: string) {
      dispatch({ type: "draft", id, text });
    },

    /** Blur / Enter / Retry: save the row's draft if it is valid and changed. */
    saveText(id: string) {
      const row = rowState(state, id);
      const server = findRequirement(state.job, id);
      if (server === undefined || row.draft === null) return;

      const error = validateText(row.draft);
      if (error !== null) {
        dispatch({ type: "invalid", id, message: error });
        return;
      }
      const text = row.draft.trim();
      if (text === server.text && row.pending === 0) {
        // Only whitespace changed: nothing to save (BR-6).
        dispatch({ type: "draft", id, text: server.text });
        return;
      }
      enqueue(id, (token) => patchRequirement(jobId, id, token, { text }), text);
    },

    /** Refetch the job. Rows keep their drafts. */
    async reload() {
      try {
        dispatch({ type: "reloaded", job: await getJob(jobId) });
      } catch {
        notify.error("Couldn't reload the job. Check your connection.", {
          id: "reload",
          action: { label: "Retry", onClick: () => void store.reload() },
        });
      }
    },
  };

  return store;
}

function toastId(requirementId: string): string {
  return `requirement-${requirementId}`;
}
