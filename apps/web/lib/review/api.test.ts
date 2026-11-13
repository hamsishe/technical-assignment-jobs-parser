import { afterEach, describe, expect, test, vi } from "vitest";

import {
  ApiError,
  NetworkError,
  REVIEWER_NAME,
  addRequirement,
  approveJob,
  deleteRequirement,
  getJob,
  isTransient,
  patchRequirement,
} from "./api";
import type { Job } from "./types";

const JOB_ID = "22222222-2222-4222-8222-222222222222";
const REQ_ID = "33333333-3333-4333-8333-333333333333";
// Microseconds and a `+` offset: the shape that breaks if parsed or left unencoded.
const TOKEN = "2026-11-13T13:35:43.123456+00:00";

const job: Job = {
  id: JOB_ID,
  title: "Backend Engineer",
  location: "Berlin",
  description: "We need someone who knows Python.",
  updated_at: null,
  reviewed_at: null,
  reviewed_by: null,
  requirements: [
    {
      id: REQ_ID,
      text: "Python",
      kind: "must_have",
      origin: "extracted",
      position: 1,
      source_quote: "knows Python",
      created_at: TOKEN,
      updated_at: TOKEN,
      updated_by: null,
      reviewed_at: null,
    },
  ],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Resolves with a Response; anything else is what fetch rejects with. */
function stubFetch(outcome: Response | Error | DOMException) {
  const fetchMock = vi.fn(() =>
    outcome instanceof Response ? Promise.resolve(outcome) : Promise.reject(outcome),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function lastCall(fetchMock: ReturnType<typeof stubFetch>) {
  const [url, init] = fetchMock.mock.lastCall as unknown as [string, RequestInit];
  return {
    url,
    method: init.method,
    headers: new Headers(init.headers),
    body: init.body === undefined ? undefined : JSON.parse(init.body as string),
    cache: init.cache,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requests", () => {
  test("getJob reads the job through /api without a reviewer header", async () => {
    const fetchMock = stubFetch(json(job));

    await expect(getJob(JOB_ID)).resolves.toEqual(job);

    const call = lastCall(fetchMock);
    expect(call.url).toBe(`/api/jobs/${JOB_ID}`);
    expect(call.method).toBe("GET");
    expect(call.headers.has("X-Reviewer-Name")).toBe(false);
    expect(call.cache).toBe("no-store");
  });

  test("keeps timestamps as the exact strings the server sent", async () => {
    stubFetch(json(job));

    const result = await getJob(JOB_ID);

    expect(result.requirements[0].updated_at).toBe(TOKEN);
  });

  test("addRequirement posts text and kind", async () => {
    const fetchMock = stubFetch(json(job, 201));

    await addRequirement(JOB_ID, { text: "Go", kind: "nice_to_have" });

    const call = lastCall(fetchMock);
    expect(call.url).toBe(`/api/jobs/${JOB_ID}/requirements`);
    expect(call.method).toBe("POST");
    expect(call.headers.get("Content-Type")).toBe("application/json");
    expect(call.body).toEqual({ text: "Go", kind: "nice_to_have" });
  });

  test("patchRequirement sends the token and only the given changes", async () => {
    const fetchMock = stubFetch(json(job));

    await patchRequirement(JOB_ID, REQ_ID, TOKEN, { text: "Python 3", approved: true });

    const call = lastCall(fetchMock);
    expect(call.url).toBe(`/api/jobs/${JOB_ID}/requirements/${REQ_ID}`);
    expect(call.method).toBe("PATCH");
    expect(call.body).toEqual({ expected_updated_at: TOKEN, text: "Python 3", approved: true });
  });

  test("patchRequirement's type rejects an empty change set (the API would 422)", () => {
    // A type-level assertion checked by `tsc`: this line must fail to compile.
    // @ts-expect-error at least one of text, kind, approved is required
    const emptyPatch = () => patchRequirement(JOB_ID, REQ_ID, TOKEN, {});
    expect(emptyPatch).toBeTypeOf("function");
  });

  test("deleteRequirement URL-encodes the token so `+` survives", async () => {
    const fetchMock = stubFetch(json(job));

    await deleteRequirement(JOB_ID, REQ_ID, TOKEN);

    const call = lastCall(fetchMock);
    expect(call.method).toBe("DELETE");
    expect(call.url).toContain("%2B00%3A00");
    expect(call.url).not.toContain("+");
    const url = new URL(call.url, "http://localhost");
    expect(url.pathname).toBe(`/api/jobs/${JOB_ID}/requirements/${REQ_ID}`);
    expect(url.searchParams.get("expected_updated_at")).toBe(TOKEN);
    expect(call.body).toBeUndefined();
  });

  test("approveJob posts to the review endpoint", async () => {
    const fetchMock = stubFetch(json(job));

    await approveJob(JOB_ID);

    const call = lastCall(fetchMock);
    expect(call.url).toBe(`/api/jobs/${JOB_ID}/review`);
    expect(call.method).toBe("POST");
  });

  test("encodes ids in the path", async () => {
    const fetchMock = stubFetch(json(job));

    await getJob("a/b?c");

    expect(lastCall(fetchMock).url).toBe("/api/jobs/a%2Fb%3Fc");
  });

  test.each([
    ["addRequirement", () => addRequirement(JOB_ID, { text: "Go" })],
    ["patchRequirement", () => patchRequirement(JOB_ID, REQ_ID, TOKEN, { kind: "nice_to_have" })],
    ["deleteRequirement", () => deleteRequirement(JOB_ID, REQ_ID, TOKEN)],
    ["approveJob", () => approveJob(JOB_ID)],
  ])("%s sends X-Reviewer-Name", async (_name, write) => {
    const fetchMock = stubFetch(json(job));

    await write();

    expect(lastCall(fetchMock).headers.get("X-Reviewer-Name")).toBe(REVIEWER_NAME);
  });
});

describe("errors", () => {
  async function caught(promise: Promise<unknown>): Promise<unknown> {
    try {
      await promise;
    } catch (error) {
      return error;
    }
    throw new Error("expected the call to fail");
  }

  test.each([
    [404, "not_found", "Job not found."],
    [409, "stale", "This requirement was changed elsewhere."],
    [409, "duplicate_text", "That requirement already exists."],
    [409, "too_few_requirements", "A job needs at least 3 requirements."],
    [409, "not_all_approved", "Approve every requirement first."],
  ])("%i %s is parsed from { detail: { code, message } }", async (status, code, message) => {
    stubFetch(json({ detail: { code, message } }, status));

    const error = await caught(getJob(JOB_ID));

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: "http", status, code, message });
  });

  test("a code the client does not know becomes unknown, keeping the message", async () => {
    stubFetch(json({ detail: { code: "brand_new", message: "Something new." } }, 409));

    expect(await caught(approveJob(JOB_ID))).toMatchObject({
      status: 409,
      code: "unknown",
      message: "Something new.",
    });
  });

  test("FastAPI's default 422 becomes validation_error with the field messages", async () => {
    stubFetch(
      json(
        {
          detail: [
            { type: "string_too_short", loc: ["body", "text"], msg: "String should have at least 1 character" },
            { type: "extra_forbidden", loc: ["body", "origin"], msg: "Extra inputs are not permitted" },
          ],
        },
        422,
      ),
    );

    expect(await caught(addRequirement(JOB_ID, { text: " " }))).toMatchObject({
      status: 422,
      code: "validation_error",
      message: "String should have at least 1 character; Extra inputs are not permitted",
    });
  });

  test("a 5xx without a JSON body is a transient server_error", async () => {
    stubFetch(new Response("Internal Server Error", { status: 502 }));

    const error = await caught(patchRequirement(JOB_ID, REQ_ID, TOKEN, { text: "Go" }));

    expect(error).toMatchObject({ status: 502, code: "server_error" });
    expect(isTransient(error)).toBe(true);
  });

  test("a 404 without our error body is not reported as not_found", async () => {
    stubFetch(json({ detail: "Not Found" }, 404));

    expect(await caught(getJob(JOB_ID))).toMatchObject({
      status: 404,
      code: "unknown",
      message: "Not Found",
    });
  });

  test("a 2xx that is not a job is invalid_response", async () => {
    stubFetch(new Response("<html></html>", { status: 200 }));

    expect(await caught(getJob(JOB_ID))).toMatchObject({ status: 200, code: "invalid_response" });
  });

  test("a rejected fetch is a NetworkError, not an ApiError", async () => {
    const cause = new TypeError("Failed to fetch");
    stubFetch(cause);

    const error = await caught(deleteRequirement(JOB_ID, REQ_ID, TOKEN));

    expect(error).toBeInstanceOf(NetworkError);
    expect(error).not.toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: "network", cause });
    expect(isTransient(error)).toBe(true);
  });

  test("an abort by the caller is rethrown unchanged", async () => {
    const controller = new AbortController();
    controller.abort();
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    stubFetch(abortError);

    expect(await caught(getJob(JOB_ID, { signal: controller.signal }))).toBe(abortError);
  });

  test("4xx business errors are not transient", async () => {
    stubFetch(json({ detail: { code: "stale", message: "Changed elsewhere." } }, 409));

    expect(isTransient(await caught(getJob(JOB_ID)))).toBe(false);
  });
});
