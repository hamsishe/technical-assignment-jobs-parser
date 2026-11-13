"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { KINDS, type Kind } from "@/lib/review/types";

const LABELS: Record<Kind, string> = {
  must_have: "Must have",
  nice_to_have: "Nice to have",
};

function isKind(value: string): value is Kind {
  return (KINDS as readonly string[]).includes(value);
}

type Props = {
  value: Kind;
  onValueChange: (kind: Kind) => void;
  disabled?: boolean;
  "aria-label"?: string;
};

/** Segmented Must have / Nice to have switch. One kind is always selected. */
export function KindSwitch({
  value,
  onValueChange,
  disabled,
  "aria-label": ariaLabel = "Kind",
}: Props) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      spacing={0}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onValueChange={(next) => {
        // Radix reports "" when the selected item is clicked again (deselect).
        // A requirement always has a kind, so ignore it.
        if (isKind(next)) onValueChange(next);
      }}
    >
      {KINDS.map((kind) => (
        <ToggleGroupItem key={kind} value={kind}>
          {LABELS[kind]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
