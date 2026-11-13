import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { expect, test, vi } from "vitest";

import { Toaster } from "@/components/ui/sonner";

import { notify } from "./notify";

test("an error snackbar shows its action and stays until dismissed", async () => {
  const user = userEvent.setup();
  const onRetry = vi.fn();
  render(<Toaster />);

  act(() => notify.error("Couldn't save.", { action: { label: "Retry", onClick: onRetry } }));

  expect(await screen.findByText("Couldn't save.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(onRetry).toHaveBeenCalledOnce();
});

test("reusing an id replaces the snackbar instead of stacking a copy", async () => {
  render(<Toaster />);

  act(() => notify.error("First", { id: "row-1" }));
  act(() => notify.error("Second", { id: "row-1" }));

  expect(await screen.findByText("Second")).toBeInTheDocument();
  expect(screen.queryByText("First")).not.toBeInTheDocument();
});
