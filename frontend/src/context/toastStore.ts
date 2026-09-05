import { createContext, useContext } from 'react';

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  tone: ToastTone;
  message: string;
}

export interface ToastContextValue {
  show: (tone: ToastTone, message: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * A lightweight confirmation for an action that just happened —
 * "Écriture validée", "Invitation envoyée" — without requiring the user
 * to notice an inline banner they may have already scrolled past. See
 * the product-wide UI/UX pass this was built for. Falls back to a
 * silent no-op outside <ToastProvider> rather than throwing, since a
 * handful of call sites (e.g. code shared with tests) may render
 * without the full app shell — a missing toast is a minor omission,
 * never worth crashing the page over.
 */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  return ctx ?? { show: () => {} };
}
