"use client";

import { PlusIcon } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { type ReviewStore, validateText } from "@/lib/review/store";
import type { Kind } from "@/lib/review/types";

import { KindSwitch } from "./kind-switch";

type Props = {
  add: ReviewStore["add"];
  /** Reports whether the form holds text, for the leave-page guard. */
  onTextChange?: (hasText: boolean) => void;
};

/** Kind (default Must have), text, Add. Enter submits; clears only once saved (spec §6). */
export function AddRequirementForm({ add, onTextChange }: Props) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<Kind>("must_have");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const messageId = useId();

  function changeText(next: string) {
    setText(next);
    onTextChange?.(next !== "");
    // Once a message is showing, keep it current as the user types.
    if (error !== null) setError(validateText(next));
  }

  async function submit() {
    if (submitting) return;
    const invalid = validateText(text);
    if (invalid !== null) {
      setError(invalid);
      return;
    }
    setSubmitting(true);
    const result = await add(text.trim(), kind);
    setSubmitting(false);
    if (result.saved) {
      changeText("");
      setKind("must_have");
    } else if (result.error !== undefined) {
      setError(result.error);
    }
  }

  return (
    <Card size="sm" role="group" aria-label="Add requirement">
      <CardContent>
        <form
          className="flex flex-wrap items-start gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <KindSwitch value={kind} onValueChange={setKind} aria-label="New requirement kind" />
          <div className="flex min-w-48 flex-1 flex-col gap-1">
            <Input
              aria-label="New requirement"
              placeholder="New requirement…"
              value={text}
              aria-invalid={error !== null || undefined}
              aria-describedby={error !== null ? messageId : undefined}
              onChange={(event) => changeText(event.target.value)}
              onKeyDown={(event) => {
                // Handled here, not by implicit form submission: that is blocked while Add
                // is disabled, and Enter on an empty input must still show the message.
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
            {error !== null && (
              <p id={messageId} className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <Button type="submit" disabled={text.trim() === "" || submitting}>
            <PlusIcon aria-hidden data-icon="inline-start" />
            Add
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
