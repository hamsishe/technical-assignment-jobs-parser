"use client";

import { CheckIcon, TriangleAlertIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { Requirement } from "@/lib/review/types";

import { KindSwitch } from "./kind-switch";
import { OriginBadge } from "./origin-badge";

function ignoreKindChange() {}

/** One requirement. Read-only for now: editing arrives with the save engine. */
export function RequirementRow({ requirement }: { requirement: Requirement }) {
  const approved = requirement.reviewed_at !== null;

  return (
    <Card size="sm" role="group" aria-label={`Requirement ${requirement.position}`}>
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <KindSwitch value={requirement.kind} onValueChange={ignoreKindChange} disabled />
          <OriginBadge origin={requirement.origin} />
          {approved && (
            <Badge className="bg-green-600 text-white dark:bg-green-700">
              <CheckIcon aria-hidden />
              Approved
            </Badge>
          )}
        </div>

        {approved ? (
          <p className="text-base md:text-sm">
            {requirement.text}
          </p>
        ) : (
          <Input aria-label="Requirement text" value={requirement.text} readOnly />
        )}

        <SourceQuote quote={requirement.source_quote} />
      </CardContent>
    </Card>
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
