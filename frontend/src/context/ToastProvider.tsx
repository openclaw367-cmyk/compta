import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { IconCheckCircle, IconInfoCircle, IconX, IconXCircle } from '../components/layout/icons';
import { ToastContext, type Toast, type ToastTone } from './toastStore';

const AUTO_DISMISS_MS = 4500;

const TONE_ICON: Record<ToastTone, (props: { className?: string }) => ReactNode> = {
  success: (p) => <IconCheckCircle {...p} />,
  error: (p) => <IconXCircle {...p} />,
  info: (p) => <IconInfoCircle {...p} />,
};

const TONE_CLASSES: Record<ToastTone, string> = {
  success: 'border-positive-soft bg-positive-soft text-positive',
  error: 'border-negative-soft bg-negative-soft text-negative',
  info: 'border-border bg-surface text-ink',
};

/**
 * Global toast notifications — see the product-wide UI/UX pass this was
 * built for. Rendered once at the app root (App.tsx, inside AppShell so
 * it only appears once signed in — auth pages have nothing to toast
 * about yet). A confirmation that just fires-and-fades, so acting on
 * something (validating an écriture, sending an invite) doesn't require
 * the user to notice or dismiss an inline banner first.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (tone: ToastTone, message: string) => {
      const id = `toast-${(nextId.current += 1)}`;
      setToasts((current) => [...current, { id, tone, message }]);
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex flex-col-reverse gap-2">
        {toasts.map((toast) => {
          const Icon = TONE_ICON[toast.tone];
          return (
            <div
              key={toast.id}
              role="status"
              className={[
                'pointer-events-auto flex w-80 max-w-[calc(100vw-2.5rem)] items-start gap-2.5 rounded-lg border px-3.5 py-3 text-[13px] shadow-card animate-[toast-in_0.2s_ease-out]',
                TONE_CLASSES[toast.tone],
              ].join(' ')}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="flex-1">{toast.message}</span>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Fermer"
                className="shrink-0 opacity-60 transition-opacity hover:opacity-100"
              >
                <IconX className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
