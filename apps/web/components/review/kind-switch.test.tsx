import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test, vi } from "vitest";

import type { Kind } from "@/lib/review/types";

import { KindSwitch } from "./kind-switch";

function Controlled({ onChange }: { onChange: (kind: Kind) => void }) {
  const [kind, setKind] = useState<Kind>("must_have");
  return (
    <KindSwitch
      value={kind}
      onValueChange={(next) => {
        onChange(next);
        setKind(next);
      }}
    />
  );
}

test("clicking the selected kind keeps it selected", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Controlled onChange={onChange} />);

  const must = screen.getByRole("radio", { name: "Must have" });
  expect(must).toBeChecked();

  await user.click(must);

  expect(must).toBeChecked();
  expect(screen.getByRole("radio", { name: "Nice to have" })).not.toBeChecked();
  expect(onChange).not.toHaveBeenCalled();
});

test("clicking the other kind selects it", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Controlled onChange={onChange} />);

  await user.click(screen.getByRole("radio", { name: "Nice to have" }));

  expect(onChange).toHaveBeenCalledExactlyOnceWith("nice_to_have");
  expect(screen.getByRole("radio", { name: "Nice to have" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Must have" })).not.toBeChecked();
});
