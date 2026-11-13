"use client";

import { CheckIcon, PencilIcon, RotateCwIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { useId, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  type RequirementView,
  type ReviewStore,
  type RowState,
  rowStatus,
} from "@/lib/review/store";

import { KindSwitch } from "./kind-switch";
import { OriginBadge } from "./origin-badge";

export type RowActions = Pick<
  ReviewStore,
  "setDraft" | "discardDraft" | "saveText" | "changeKind" | "approve" | "remove" | "reload"
>;

type Props = {
  requirement: RequirementView;
  row: RowState;
  actions: RowActions;
};

/**
 * Approved rows read as plain text with Edit. "submitted" is an approved row whose edit
 * was sent: it returns to read-only once the save lands, and stays editable if it fails
 * or is invalid (spec §6).
 */
type EditMode = "view" | "editing" | "submitted";

/** One requirement: kind switch, origin, text, quote, Approve/Edit and Delete. */
export function RequirementRow({ requirement, row, actions }: Props) {
  const { id, approved } = requirement;
  const [mode, setMode] = useState<EditMode>("view");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const messageId = useId();
  const status = rowStatus(row);

  const unsettled = row.draft !== null || status !== "idle";
  const showInput = !approved || mode === "editing" || (mode === "submitted" && unsettled);

  function submit() {
    if (row.draft === null) {
      if (mode === "editing") setMode("view");
      return;
    }
    actions.saveText(id);
    if (approved) setMode("submitted");
  }

  return (
    <Card size="sm" role="group" aria-label={`Requirement ${requirement.position}`}>
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <KindSwitch value={requirement.kind} onValueChange={(kind) => actions.changeKind(id, kind)} />
          <OriginBadge origin={requirement.origin} />
          {approved && (
            <Badge className="bg-green-600 text-white dark:bg-green-700">
              <CheckIcon aria-hidden />
              Approved
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-1">
            {!approved && (
              <Button
                size="sm"
                variant="outline"
                // Q4: an invalid draft blocks approval; the message below says why.
                disabled={row.error !== null}
                // Keep focus in the input so a pending edit goes out with the approval
                // in one request, instead of a blur save first.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => actions.approve(id)}
              >
                <CheckIcon aria-hidden data-icon="inline-start" />
                Approve
              </Button>
            )}
            {approved && !showInput && (
              <Button size="sm" variant="ghost" onClick={() => setMode("editing")}>
                <PencilIcon aria-hidden data-icon="inline-start" />
                Edit
              </Button>
            )}
            <Button
              size="sm"
              variant={confirmingDelete ? "destructive" : "ghost"}
              aria-label={confirmingDelete ? undefined : "Delete"}
              onClick={() => (confirmingDelete ? actions.remove(id) : setConfirmingDelete(true))}
              onBlur={() => setConfirmingDelete(false)}
            >
              <Trash2Icon aria-hidden data-icon={confirmingDelete ? "inline-start" : undefined} />
              {confirmingDelete && "Confirm delete"}
            </Button>
          </div>
        </div>

        {showInput ? (
          <Input
            aria-label="Requirement text"
            value={row.draft ?? requirement.text}
            aria-invalid={row.error !== null || undefined}
            aria-describedby={row.error !== null ? messageId : undefined}
            // Opened with Edit: the user wants to type now.
            autoFocus={approved}
            onChange={(event) => actions.setDraft(id, event.target.value)}
            onBlur={submit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              } else if (event.key === "Escape") {
                actions.discardDraft(id);
                setMode("view");
              }
            }}
          />
        ) : (
          <p className="text-base md:text-sm">{requirement.text}</p>
        )}

        <RowMessage row={row} messageId={messageId} actions={actions} id={id} />
        <SourceQuote quote={requirement.source_quote} />
      </CardContent>
    </Card>
  );
}

function RowMessage({
  row,
  messageId,
  actions,
  id,
}: {
  row: RowState;
  messageId: string;
  actions: RowActions;
  id: string;
}) {
  if (row.error !== null) {
    return (
      <p id={messageId} className="text-sm text-destructive">
        {row.error}
      </p>
    );
  }
  if (row.pending > 0 || row.failure === null) return null;

  const stale = row.failure === "stale";
  return (
    <p className="flex items-center gap-1 text-sm text-destructive">
      {stale ? "Not saved · Changed elsewhere" : "Not saved"}
      <span aria-hidden>·</span>
      <Button
        size="xs"
        variant="link"
        className="h-auto px-0"
        onClick={() => (stale ? void actions.reload() : actions.saveText(id))}
      >
        <RotateCwIcon aria-hidden data-icon="inline-start" />
        {stale ? "Reload" : "Retry"}
      </Button>
    </p>
  );
}

function SourceQuote({ quote }: { quote: string | null }) {
  if (quote === null) {
    // The main clue that the extractor invented this requirement (spec §6).
    return (
      <p className="flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-400">
        <TriangleAlertIcon aria-hidden className="size-4" />
        Not found in the job description
      </p>
    );
  }
  return <p className="text-sm text-muted-foreground italic">“{quote}”</p>;
}
