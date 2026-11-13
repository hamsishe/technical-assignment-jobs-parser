// Client state for the review page (D4): one pure reducer over the server job plus
// per-row drafts and save status, and a per-requirement promise queue.
//
// The reducer runs inside a tiny external store (read with useSyncExternalStore) rather
// than React's useReducer, because the queue must read the latest `updated_at` token
// synchronously when the next request leaves. React state seen through a ref lags a
// commit, and a lagging token turns a chained edit into a 409.

import {
  ApiError,
  addRequirement,
  approveJob,
  deleteRequirement,
  getJob,
  isTransient,
  patchRequirement,
} from "./api";
import { notify } from "./notify";
import type { Job, Kind, Requirement, RequirementChanges } from "./types";

export const MAX_TEXT_LENGTH = 500;

/** Why the last save of a row did not land. */
export type RowFailure =
  /** Network error or 5xx on a text save: the text is kept, "Not saved · Retry". */
  | "transient"
  /** 409 stale or 404: someone else changed or deleted it. Cleared by a reload (Q5). */
  | "stale";

/** What the UI shows before the server confirms: kind, approval and delete (spec §6). */
export interface Overlay {
  op: number;
  kind?: Kind;
  approved?: boolean;
  deleted?: boolean;
}

export interface RowState {
  /** Text in the input that is not saved yet; null when the input shows the server text. */
  draft: string | null;
  /** Inline message: an invalid draft or a server rejection (422, 409 duplicate_text). */
  error: string | null;
  failure: RowFailure | null;
  /** Requests queued or in flight for this row. */
  pending: number;
  /** The text the latest queued text save sends, while requests are pending. */
  sentText: string | null;
  overlays: readonly Overlay[];
}

export type RowStatus = "idle" | "saving" | "failed" | "invalid";

export interface ReviewState {
  job: Job;
  rows: Readonly<Record<string, RowState>>;
  /** Add and approve-job requests in flight (they belong to no single row). */
  jobPending: number;
  /** A write in this session cleared the job's review (BR-4): say why it is not reviewed. */
  reviewCleared: boolean;
}

export type Action =
  | { type: "payload"; job: Job }
  | { type: "draft"; id: string; text: string }
  | { type: "discard"; id: string }
  | { type: "invalid"; id: string; message: string }
  | { type: "sent"; id: string; op: number; text?: string; overlay?: Omit<Overlay, "op"> }
  | { type: "saved"; id: string; op: number; job: Job; text?: string }
  | { type: "failed"; id: string; op: number; text?: string; failure?: RowFailure; error?: string }
  | { type: "reloaded"; job: Job }
  | { type: "jobSent" }
  | { type: "jobSaved"; job: Job }
  | { type: "jobFailed" };

const EMPTY_ROW: RowState = {
  draft: null,
  error: null,
  failure: null,
  pending: 0,
  sentText: null,
  overlays: [],
};

export function initialState(job: Job): ReviewState {
  return { job, rows: {}, jobPending: 0, reviewCleared: false };
}

export function rowState(state: ReviewState, id: string): RowState {
  return state.rows[id] ?? EMPTY_ROW;
}

export function reduce(state: ReviewState, action: Action): ReviewState {
  switch (action.type) {
    case "payload":
      return acceptJob(state, action.job);

    case "draft": {
      const row = rowState(state, action.id);
      // Typing back to the text the server has (or is about to have) is not a draft.
      const draft = action.text === expectedText(state, action.id) ? null : action.text;
      // Once a message is showing, keep it current as the user types.
      const error = row.error === null || draft === null ? null : validateText(draft);
      return withRow(state, action.id, { ...row, draft, error });
    }

    case "discard": {
      // Escape: back to the saved text, so nothing about the text is left unsaved.
      const row = rowState(state, action.id);
      return withRow(state, action.id, {
        ...row,
        draft: null,
        error: null,
        failure: row.failure === "transient" ? null : row.failure,
      });
    }

    case "invalid":
      return withRow(state, action.id, { ...rowState(state, action.id), error: action.message });

    case "sent": {
      const row = rowState(state, action.id);
      const sendsText = action.text !== undefined;
      return withRow(state, action.id, {
        ...row,
        // A new text save replaces the outcome of the last one.
        error: sendsText ? null : row.error,
        failure: sendsText ? null : row.failure,
        pending: row.pending + 1,
        sentText: action.text ?? row.sentText,
        overlays: action.overlay ? [...row.overlays, { ...action.overlay, op: action.op }] : row.overlays,
      });
    }

    case "saved": {
      const row = settled(rowState(state, action.id), action.op);
      // The draft is done only if it still says what was saved; the user may have typed on.
      const draftSaved =
        action.text !== undefined && row.draft !== null && row.draft.trim() === action.text;
      return withRow(acceptJob(state, action.job), action.id, { ...row, draft: draftSaved ? null : row.draft });
    }

    case "failed": {
      const row = settled(rowState(state, action.id), action.op);
      return withRow(state, action.id, {
        ...row,
        // Never lose the text silently: if the user typed back meanwhile, restore what failed.
        draft: row.draft ?? action.text ?? null,
        failure: action.failure ?? row.failure,
        error: action.error ?? row.error,
      });
    }

    case "reloaded": {
      // Q5: a reload answers "changed elsewhere". The conflicting row drops its draft and
      // shows the other version; every other row keeps its draft.
      const rows = Object.fromEntries(
        Object.entries(state.rows).map(([id, row]) => [
          id,
          row.failure === "stale" ? { ...row, draft: null, error: null, failure: null } : row,
        ]),
      );
      return acceptJob({ ...state, rows }, action.job);
    }

    case "jobSent":
      return { ...state, jobPending: state.jobPending + 1 };

    case "jobSaved":
      return acceptJob({ ...state, jobPending: state.jobPending - 1 }, action.job);

    case "jobFailed":
      return { ...state, jobPending: state.jobPending - 1 };
  }
}

/** One request settled: drop its overlay (revert on failure, server state on success). */
function settled(row: RowState, op: number): RowState {
  const pending = row.pending - 1;
  return {
    ...row,
    pending,
    sentText: pending === 0 ? null : row.sentText,
    overlays: row.overlays.filter((o) => o.op !== op),
  };
}

function withRow(state: ReviewState, id: string, row: RowState): ReviewState {
  return { ...state, rows: { ...state.rows, [id]: row } };
}

function findRequirement(job: Job, id: string): Requirement | undefined {
  return job.requirements.find((r) => r.id === id);
}

/** The text the server will hold once queued requests land. */
function expectedText(state: ReviewState, id: string): string | undefined {
  const row = rowState(state, id);
  if (row.pending > 0 && row.sentText !== null) return row.sentText;
  return findRequirement(state.job, id)?.text;
}

/**
 * Take a server payload if it is not older than the one held. Every write bumps
 * `jobs.updated_at` under the job lock (D1), so a payload with an older stamp was
 * overtaken by one we already hold: applying it would roll back another row's newer
 * token. Equal stamps (approve job, no-op PATCH) take the later arrival.
 */
function acceptJob(state: ReviewState, incoming: Job): ReviewState {
  if (compareTimestamps(incoming.updated_at, state.job.updated_at) < 0) return state;
  const wasReviewed = state.job.reviewed_at !== null;
  const isReviewed = incoming.reviewed_at !== null;
  return {
    ...state,
    job: incoming,
    reviewCleared: isReviewed ? false : state.reviewCleared || wasReviewed,
  };
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

/** A requirement as the user sees it: the server row with unconfirmed changes applied. */
export interface RequirementView extends Requirement {
  approved: boolean;
}

/** Requirements as the user should see them: overlays applied, deletes hidden, in order. */
export function visibleRequirements(state: ReviewState): RequirementView[] {
  return state.job.requirements
    .flatMap((requirement) => {
      let shown: RequirementView = { ...requirement, approved: requirement.reviewed_at !== null };
      for (const overlay of rowState(state, requirement.id).overlays) {
        if (overlay.deleted) return [];
        if (overlay.kind !== undefined) shown = { ...shown, kind: overlay.kind };
        if (overlay.approved !== undefined) shown = { ...shown, approved: overlay.approved };
      }
      return [shown];
    })
    .sort((a, b) => a.position - b.position);
}

export type SaveStatus =
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "unsaved"; count: number };

/** Header save status: "Saving…" / "All changes saved" / "N changes not saved". */
export function saveStatus(state: ReviewState): SaveStatus {
  if (isSaving(state)) return { kind: "saving" };
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
    isSaving(state) ||
    currentRows(state).some((row) => row.draft !== null || row.failure !== null || row.error !== null)
  );
}

function isSaving(state: ReviewState): boolean {
  return state.jobPending > 0 || Object.values(state.rows).some((row) => row.pending > 0);
}

export const MIN_REQUIREMENTS = 3;

/**
 * Why Approve job is disabled, or null when it can be clicked (BR-9 plus spec §6:
 * nothing pending, failed or invalid). Unsaved drafts count as not saved: the job must
 * be approved against what is on the server.
 */
export function approveJobBlocker(state: ReviewState): string | null {
  if (state.job.reviewed_at !== null) return "Already approved.";
  if (isSaving(state)) return "Wait until changes are saved.";

  const rows = currentRows(state);
  if (rows.some((row) => row.error !== null)) return "Fix the highlighted requirement first.";
  if (rows.some((row) => row.failure !== null || row.draft !== null)) {
    return "Some changes are not saved.";
  }

  const requirements = state.job.requirements;
  if (requirements.length < MIN_REQUIREMENTS) {
    return `Needs at least ${MIN_REQUIREMENTS} requirements (has ${requirements.length}).`;
  }
  const unapproved = requirements.filter((r) => r.reviewed_at === null).length;
  if (unapproved > 0) {
    return unapproved === 1
      ? "1 requirement is not approved yet."
      : `${unapproved} requirements are not approved yet.`;
  }
  return null;
}

/** Row state for requirements that still exist (a row deleted elsewhere has nothing to save). */
function currentRows(state: ReviewState): RowState[] {
  return state.job.requirements.map((r) => rowState(state, r.id));
}

// ── Store ────────────────────────────────────────────────────────────────────

export type ReviewStore = ReturnType<typeof createReviewStore>;

interface Operation {
  request: (token: string) => Promise<Job>;
  /** The text this request saves, if any (it then owns the row's draft outcome). */
  text?: string;
  overlay?: Omit<Overlay, "op">;
  /** Runs the same user action again, from the snackbar. */
  retry: () => void;
}

export function createReviewStore(initialJob: Job) {
  const jobId = initialJob.id;
  let state = initialState(initialJob);
  let nextOp = 1;
  const listeners = new Set<() => void>();
  const queues = new Map<string, Promise<void>>();

  function dispatch(action: Action) {
    state = reduce(state, action);
    for (const listener of listeners) listener();
  }

  /**
   * Run the request after every earlier request for the same requirement has settled,
   * with the token current at that moment: the previous response's, or a newer payload's.
   */
  function enqueue(id: string, operation: Operation) {
    const op = nextOp++;
    const { text } = operation;
    dispatch({ type: "sent", id, op, text, overlay: operation.overlay });

    const previous = queues.get(id) ?? Promise.resolve();
    const current = previous.then(async () => {
      const token = findRequirement(state.job, id)?.updated_at;
      if (token === undefined) {
        // Deleted, here or elsewhere, while this request waited its turn.
        fail(id, op, operation, new ApiError(404, "not_found", "This requirement no longer exists."));
        return;
      }
      try {
        const job = await operation.request(token);
        dispatch({ type: "saved", id, op, job, text });
        notify.dismiss(toastId(id));
      } catch (error) {
        fail(id, op, operation, error);
      }
    });
    queues.set(id, current);
    void current.then(() => {
      if (queues.get(id) === current) queues.delete(id);
    });
  }

  function fail(id: string, op: number, operation: Operation, error: unknown) {
    const { text } = operation;
    if (isTransient(error)) {
      // A text save keeps its text and marks the row; kind, approve and delete revert.
      dispatch({ type: "failed", id, op, text, failure: text === undefined ? undefined : "transient" });
      notify.error("Couldn't save. Check your connection.", {
        id: toastId(id),
        action: { label: "Retry", onClick: operation.retry },
      });
    } else if (error instanceof ApiError && (error.code === "stale" || error.code === "not_found")) {
      dispatch({ type: "failed", id, op, text, failure: "stale" });
      notify.error("This requirement was changed elsewhere", {
        id: toastId(id),
        action: { label: "Reload", onClick: () => void store.reload() },
      });
    } else {
      // A business rule or validation answer (409 duplicate_text, 422): no retry.
      const message = error instanceof Error ? error.message : "Couldn't save.";
      if (text !== undefined) {
        dispatch({ type: "failed", id, op, text, error: message }); // shown on the row
      } else {
        dispatch({ type: "failed", id, op });
        notify.error(message, { id: toastId(id) });
      }
    }
  }

  /** The valid, changed draft to save, `null` if there is nothing to save, or the message. */
  function draftToSave(id: string): { text: string | null } | { error: string } {
    const { draft } = rowState(state, id);
    if (draft === null) return { text: null };
    const error = validateText(draft);
    if (error !== null) return { error };
    const text = draft.trim();
    return { text: text === expectedText(state, id) ? null : text };
  }

  function patch(id: string, changes: RequirementChanges) {
    return (token: string) => patchRequirement(jobId, id, token, changes);
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

    /** Escape: restore the last saved text. */
    discardDraft(id: string) {
      dispatch({ type: "discard", id });
    },

    /** Blur / Enter / Retry: save the row's draft if it is valid and changed. */
    saveText(id: string) {
      // Changed elsewhere: resending with the same token can only fail again. The row
      // waits for Reload (Q5), which brings a fresh token.
      if (rowState(state, id).failure === "stale") return;
      const result = draftToSave(id);
      if ("error" in result) {
        dispatch({ type: "invalid", id, message: result.error });
        return;
      }
      const { text } = result;
      if (text === null) {
        // Unchanged, or only whitespace changed: nothing to save (BR-6).
        if (rowState(state, id).draft !== null) dispatch({ type: "discard", id });
        return;
      }
      enqueue(id, { request: patch(id, { text }), text, retry: () => store.saveText(id) });
    },

    /** Optimistic; reverts with a snackbar if it fails. Approval is unchanged (BR-8). */
    changeKind(id: string, kind: Kind) {
      enqueue(id, {
        request: patch(id, { kind }),
        overlay: { kind },
        retry: () => store.changeKind(id, kind),
      });
    },

    /** Approve, with the row's pending valid text in the same request. */
    approve(id: string) {
      const result = draftToSave(id);
      if ("error" in result) {
        // Q4: an invalid draft blocks Approve; the inline message says why.
        dispatch({ type: "invalid", id, message: result.error });
        return;
      }
      const text = result.text ?? undefined;
      enqueue(id, {
        request: patch(id, text === undefined ? { approved: true } : { approved: true, text }),
        text,
        overlay: { approved: true },
        retry: () => store.approve(id),
      });
    },

    /** Permanent. Hidden at once; comes back with a snackbar if the delete fails. */
    remove(id: string) {
      enqueue(id, {
        request: (token) => deleteRequirement(jobId, id, token),
        overlay: { deleted: true },
        retry: () => store.remove(id),
      });
    },

    /**
     * Add a requirement (created approved, last position). Resolves to whether it was
     * saved, so the form clears only on success; a rejection message is for the form.
     */
    async add(text: string, kind: Kind): Promise<{ saved: true } | { saved: false; error?: string }> {
      dispatch({ type: "jobSent" });
      try {
        dispatch({ type: "jobSaved", job: await addRequirement(jobId, { text, kind }) });
        notify.dismiss("add");
        return { saved: true };
      } catch (error) {
        dispatch({ type: "jobFailed" });
        if (isTransient(error)) {
          // The text stays in the form; Add is the retry.
          notify.error("Couldn't add the requirement. Check your connection.", { id: "add" });
          return { saved: false };
        }
        return { saved: false, error: error instanceof Error ? error.message : "Couldn't add." };
      }
    },

    /** Mark the job reviewed (BR-9). The button is disabled while approveJobBlocker says why. */
    async approveJob() {
      dispatch({ type: "jobSent" });
      try {
        dispatch({ type: "jobSaved", job: await approveJob(jobId) });
        notify.dismiss("approve-job");
      } catch (error) {
        dispatch({ type: "jobFailed" });
        if (isTransient(error)) {
          notify.error("Couldn't approve the job. Check your connection.", {
            id: "approve-job",
            action: { label: "Retry", onClick: () => void store.approveJob() },
          });
        } else {
          // 409 too_few_requirements / not_all_approved: the list changed elsewhere.
          const message = error instanceof Error ? error.message : "Couldn't approve the job.";
          notify.error(message, {
            id: "approve-job",
            action: { label: "Reload", onClick: () => void store.reload() },
          });
        }
      }
    },

    /** Refetch the job (Q5: the conflicting row drops its draft, other rows keep theirs). */
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
