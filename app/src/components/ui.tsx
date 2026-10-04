import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "../lib/cn";

export const inputCls =
  "w-full rounded-lg border border-line-2 bg-surface-2 px-3 py-2 text-sm text-ink placeholder-ink-4 focus:outline-none";

export const labelCls = "mb-1 block text-xs font-medium uppercase tracking-wide text-ink-3";

export function Button({
  children,
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "dark" }) {
  const styles: Record<string, string> = {
    primary:
      "bg-accent text-accent-ink hover:bg-accent-hover font-semibold shadow",
    danger: "bg-danger text-white hover:brightness-110",
    ghost: "border border-line-2 text-ink hover:bg-hover",
    dark: "bg-surface-3 text-ink hover:bg-surface-3 border border-line",
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
      "bg-accent text-accent-ink hover:bg-accent-hover font-semibold shadow",
    ghost: "border border-line-2 text-ink hover:bg-hover",
    dark: "bg-surface-3 text-ink hover:bg-surface-3 border border-line",
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
    <div className={cn("rounded-2xl border border-line bg-surface p-4", className)}>{children}</div>
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
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-2 py-14 text-center">
      {icon && <div className="mb-3 text-ink-4">{icon}</div>}
      <div className="font-medium text-ink">{title}</div>
      {text && <p className="mt-1 max-w-sm text-sm text-ink-3">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "h-6 w-6 animate-spin rounded-full border-2 border-line-2 border-t-accent",
        className,
      )}
    />
  );
}

export function Modal({
  open,
  onClose,
  title,
  width = "max-w-sm",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Classe de largeur : "max-w-sm" par defaut, "max-w-lg"/"max-w-2xl" pour les formulaires. */
  width?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    /* Le focus part dans la modale : clavier et lecteurs d'ecran restent coherents. */
    const t = setTimeout(() => ref.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className={`relative max-h-[92vh] w-full ${width} overflow-y-auto rounded-t-2xl bg-surface-2 p-5 outline-none sm:rounded-2xl`}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="font-semibold text-ink">{title}</h3>
          <button onClick={onClose} aria-label="Fermer" className="text-ink-3 hover:text-ink">
            ✕
          </button>
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
        <h1 className="text-xl font-semibold text-ink sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-3">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}