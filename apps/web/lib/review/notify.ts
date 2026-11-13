// The one place the review page raises snackbars, so tests can spy on `notify`.
// Spec §6: error snackbars stay until dismissed and stack; success is shown only in the
// header save status, never as a snackbar.

import { toast } from "sonner";

export type NotifyAction = { label: string; onClick: () => void };

export const notify = {
  /** A sticky error. Reusing an `id` replaces that snackbar instead of stacking a copy. */
  error(message: string, options: { id?: string; action?: NotifyAction } = {}): void {
    toast.error(message, {
      id: options.id,
      duration: Infinity,
      closeButton: true,
      action: options.action,
    });
  },

  dismiss(id: string): void {
    toast.dismiss(id);
  },
};
