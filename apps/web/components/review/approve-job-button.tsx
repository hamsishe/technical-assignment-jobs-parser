"use client";

import { CheckCheckIcon } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";

type Props = {
  /** Why the job cannot be approved now, or null when it can. */
  blocker: string | null;
  onApprove: () => void;
};

/**
 * Approve job, with the reason beside it while disabled. The reason is text, not a
 * tooltip: disabled buttons get no hover or focus, and the spec says "with the reason
 * shown".
 */
export function ApproveJobButton({ blocker, onApprove }: Props) {
  const reasonId = useId();
  return (
    <div className="flex items-center gap-2">
      {blocker !== null && (
        <span id={reasonId} className="text-sm text-muted-foreground">
          {blocker}
        </span>
      )}
      <Button
        disabled={blocker !== null}
        aria-describedby={blocker !== null ? reasonId : undefined}
        onClick={onApprove}
      >
        <CheckCheckIcon aria-hidden data-icon="inline-start" />
        Approve job
      </Button>
    </div>
  );
}
