import { renderHook, screen, within } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, expect, test, vi } from "vitest";

import { jsonResponse, makeJob, makeRequirement, withChange } from "@/lib/review/test-fixtures";

import { offline, renderReview, row, saveStatus, textbox } from "./testing";
import { useLeaveGuard } from "./use-leave-guard";

afterEach(() => {
  toast.dismiss();
  vi.unstubAllGlobals();
});

const T0 = "2026-11-13T10:00:00Z";
const T1 = "2026-11-13T10:00:01Z";

/** True when leaving now would show the browser's "Leave site?" dialog. */
function leaveIsBlocked(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

function job() {
  return makeJob({
    updated_at: T0,
    requirements: [makeRequirement({ position: 1, text: "Active RN licence", updated_at: T0 })],
  });
}

const addInput = () => screen.getByRole("textbox", { name: "New requirement" });

test("not armed when everything is saved", async () => {
  await renderReview(job());

  expect(leaveIsBlocked()).toBe(false);
});

test("armed while the add form has text, and disarmed when it is cleared", async () => {
  const { user } = await renderReview(job());

  await user.type(addInput(), "BLS");
  expect(leaveIsBlocked()).toBe(true);

  await user.clear(addInput());
  expect(leaveIsBlocked()).toBe(false);
});

test("armed after a failed save, and disarmed once the retry lands", async () => {
  const data = job();
  const [first] = data.requirements;
  const { user } = await renderReview(
    data,
    offline(),
    jsonResponse(withChange(data, T1, first.id, { text: "RN licence", origin: "edited" })),
  );

  await user.clear(textbox(1));
  await user.type(textbox(1), "RN licence");
  await user.tab();
  await vi.waitFor(() => expect(saveStatus()).toHaveTextContent("1 change not saved"));
  expect(leaveIsBlocked()).toBe(true);

  await user.click(within(row(1)).getByRole("button", { name: "Retry" }));
  await vi.waitFor(() => expect(saveStatus()).toHaveTextContent("All changes saved"));
  expect(leaveIsBlocked()).toBe(false);
});

test("armed while a row holds an unsaved draft", async () => {
  const { user } = await renderReview(job());

  await user.type(textbox(1), " (Ontario)");

  expect(leaveIsBlocked()).toBe(true);
});

test("the hook adds the listener only while armed and removes it after", () => {
  const { rerender, unmount } = renderHook(({ armed }) => useLeaveGuard(armed), {
    initialProps: { armed: false },
  });
  expect(leaveIsBlocked()).toBe(false);

  rerender({ armed: true });
  expect(leaveIsBlocked()).toBe(true);

  unmount();
  expect(leaveIsBlocked()).toBe(false);
});
