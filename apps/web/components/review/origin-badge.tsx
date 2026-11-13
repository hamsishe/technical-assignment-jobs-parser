import { cva } from "class-variance-authority";

import { Badge } from "@/components/ui/badge";
import type { Origin } from "@/lib/review/types";

// Spec §6: grey for extracted, green for edited, yellow for added. Kept here rather than
// as variants in ui/badge.tsx so regenerating shadcn components never drops them.
const originVariants = cva("", {
  variants: {
    origin: {
      extracted: "bg-secondary text-secondary-foreground",
      edited: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
      added: "bg-yellow-100 text-yellow-900 dark:bg-yellow-950 dark:text-yellow-300",
    },
  },
});

export function OriginBadge({ origin }: { origin: Origin }) {
  return (
    <Badge variant="secondary" data-origin={origin} className={originVariants({ origin })}>
      {origin}
    </Badge>
  );
}
