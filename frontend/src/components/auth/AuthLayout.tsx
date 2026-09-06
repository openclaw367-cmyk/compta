import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BrandMark } from '../layout/BrandMark';

/**
 * The shared shell for every unauthenticated screen (login, signup,
 * forgot/reset password, accept invite) — a centered card, no sidebar/
 * topbar chrome, same brand mark and design tokens (bg-surface,
 * border-border, text-ink, bg-accent, shadow-card) every other screen
 * already uses. Polish here means restraint and consistency with the
 * rest of the app, not a new visual language — see CLAUDE.md "Multi-user
 * / roles & permissions".
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-[400px]">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2.5">
          <BrandMark size={32} />
          <span className="text-[17px] font-semibold tracking-tight text-ink">Citaledge</span>
        </Link>

        <div className="rounded-lg border border-border bg-surface p-7 shadow-card">
          <h1 className="text-[19px] font-semibold tracking-tight text-ink">{title}</h1>
          {subtitle && <p className="mt-1 text-[13px] text-ink-muted">{subtitle}</p>}
          <div className="mt-6 flex flex-col gap-4">{children}</div>
        </div>

        {footer && <div className="mt-5 text-center text-[13px] text-ink-muted">{footer}</div>}
      </div>
    </div>
  );
}

export function AuthField({
  label,
  children,
  error,
}: {
  label: string;
  children: ReactNode;
  error?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium text-ink-muted">{label}</span>
      {children}
      {error && <span className="text-[12px] text-negative">{error}</span>}
    </label>
  );
}

export function AuthInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full rounded-md border border-border bg-bg px-3 py-2 text-[13.5px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
    />
  );
}

export function AuthSubmitButton({
  children,
  pending,
  disabled,
}: {
  children: ReactNode;
  pending?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="mt-1 w-full rounded-md bg-accent px-4 py-2.5 text-[13.5px] font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-ink-faint"
    >
      {pending ? '…' : children}
    </button>
  );
}

export function AuthError({ messages }: { messages: string[] | null }) {
  if (!messages || messages.length === 0) return null;
  return (
    <div className="rounded-md bg-negative-soft px-3.5 py-2.5 text-[13px] text-negative">
      {messages.map((message, i) => (
        <div key={i}>{message}</div>
      ))}
    </div>
  );
}
