"use client";

import { useEffect } from "react";

/**
 * While `armed`, leaving the page (close, reload, typing a new URL) shows the browser's
 * own "Leave site?" dialog. Its text cannot be customised (spec §6).
 */
export function useLeaveGuard(armed: boolean): void {
  useEffect(() => {
    if (!armed) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      // Older Chromium and Safari still need returnValue set to show the dialog.
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [armed]);
}
