import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import type { SaveStatus } from "@/lib/review/store";
import { makeJob } from "@/lib/review/test-fixtures";

import { ReviewHeader } from "./review-header";

test.each<[SaveStatus, string]>([
  [{ kind: "saving" }, "Saving…"],
  [{ kind: "saved" }, "All changes saved"],
  [{ kind: "unsaved", count: 1 }, "1 change not saved"],
  [{ kind: "unsaved", count: 3 }, "3 changes not saved"],
])("save status %o reads %s", (status, text) => {
  render(<ReviewHeader job={makeJob()} saveStatus={status} />);

  expect(screen.getByRole("status", { name: "Save status" })).toHaveTextContent(text);
});
