"use client";

import { useState, useSyncExternalStore } from "react";

import { createReviewStore, type ReviewState, type ReviewStore } from "@/lib/review/store";
import type { Job } from "@/lib/review/types";

/** One store per mounted review page, created from the job it loaded. */
export function useReviewStore(initialJob: Job): [ReviewState, ReviewStore] {
  const [store] = useState(() => createReviewStore(initialJob));
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return [state, store];
}
