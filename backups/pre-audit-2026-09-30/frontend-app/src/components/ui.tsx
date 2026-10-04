import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "../lib/cn";

export const inputCls =
  "w-full rounded-lg border border-white/15 bg-[#271a10] px-3 py-2 text-sm text-stone-100 placeholder-stone-500 focus:outline-none";

export const labelCls = "mb-1 block text-xs font-medium uppercase tracking-wide text-stone-400";

export function Button({
  children,
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "dark" }) {
  const styles: Record<string, string> = {
    primary:
      "bg-[#14b8a6] text-[#0c1413] hover:bg-[#0fb69f] font-semibold shadow",
    danger: "bg-red-600/90 text-white hover:bg-red-500",
    ghost: "border border-white/15 text-stone-200 hover:bg-white/10",
    dark: "bg-[#3c2a1a] text-stone-100 hover:bg-[#4a3524] border border-white/10",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm transition disabled:opacity-50",
        styles[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  to,
  children,
  variant = "primary",
  className,
}: {
  to: string;
  children: ReactNode;
  variant?: "primary" | "ghost" | "dark";
  className?: string;
}) {
  const styles: Record<string, string> = {
    primary:
      "bg-[#14b8a6] text-[#0c1413] hover:bg-[#0fb69f] font-semibold shadow",
    ghost: "border border-white/15 text-stone-200 hover:bg-white/10",
    dark: "bg-[#3c2a1a] text-stone-100 hover:bg-[#4a3524] border border-white/10",
  };
  return (
    <Link
      to={to}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm transition",
        styles[variant],
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-white/10 bg-[#251710] p-4", className)}>{children}</div>
  );
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 py-14 text-center">
      {icon && <div className="mb-3 text-stone-500">{icon}</div>}
      <div className="font-medium text-stone-200">{title}</div>
      {text && <p className="mt-1 max-w-sm text-sm text-stone-400">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-[#14b8a6]",
        className,
      )}
    />
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-t-2xl bg-[#2a1b10] p-5 sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-white">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-white sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-stone-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}