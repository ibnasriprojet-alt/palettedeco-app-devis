import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import {
  AlertCircle,
  ChevronDown,
  FilePlus2,
  FileText,
  ClipboardList,
  Users,
  ReceiptText,
  Settings,
  LogOut,
  LayoutDashboard,
  Wallet,
  Landmark,
  Menu,
  X,
} from "lucide-react";
import { clearSession } from "../pages/Login";
import { useTheme } from "./ThemeProvider";
import { PERIODS, usePeriod, type PeriodId } from "../lib/period";
import { api } from "../lib/api";

/* Ordre choisi pour le geste quotidien : on passe des clients aux documents,
   puis on traite l'argent (depenses, tresorerie, relances). */
const navItems = [
  { to: "/", label: "Tableau de bord", short: "Bord", icon: LayoutDashboard },
  { to: "/quotes", label: "Devis", short: "Devis", icon: FileText },
  { to: "/orders", label: "Commandes", short: "Cmd", icon: ClipboardList },
  { to: "/invoices", label: "Factures", short: "Fact.", icon: ReceiptText },
  { to: "/clients", label: "Clients", short: "Clients", icon: Users },
  { to: "/expenses", label: "Depenses", short: "Dep.", icon: Wallet },
  { to: "/cash", label: "Tresorerie", short: "Treso.", icon: Landmark },
  { to: "/relances", label: "Relances", short: "Rel.", icon: AlertCircle },
  { to: "/settings", label: "Reglages", short: "Regl.", icon: Settings },
];

function CompanyName() {
  const [name, setName] = useState<string>("");
  useEffect(() => {
    let alive = true;
    api
      .getCompany()
      .then((c) => alive && setName(c?.name || "PaletteD&co"))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return (
    <div className="min-w-0">
      <div className="truncate font-display text-lg font-semibold leading-tight">{name || "PaletteD&co"}</div>
      <div className="text-[11px] text-brand-2">Devis & Factures</div>
    </div>
  );
}

function PeriodSelect() {
  const { period, setPeriod } = usePeriod();
  return (
    <label className="relative">
      <span className="sr-only">Periode d'analyse</span>
      <select
        value={period}
        onChange={(e) => setPeriod(e.target.value as PeriodId)}
        className="appearance-none rounded-lg border border-line bg-surface-2 py-2 pl-3 pr-8 text-sm text-ink outline-none hover:bg-hover"
      >
        {PERIODS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-4" />
    </label>
  );
}

function QuickCreate() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const items = [
    { to: "/quotes/new", label: "Nouveau devis", icon: FileText },
    { to: "/expenses/new", label: "Nouvelle depense", icon: Wallet, onClick: () => window.dispatchEvent(new CustomEvent("open-expense-form")) },
    { to: "/clients/new", label: "Nouveau client", icon: Users },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-ink shadow transition hover:bg-accent-hover"
      >
        <FilePlus2 className="h-4 w-4" />
        <span className="hidden sm:inline">Creer</span>
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1.5 w-52 overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
          {items.map((it) => (
            <Link
              key={it.to}
              to={it.to}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-ink-2 transition hover:bg-hover hover:text-ink"
            >
              <it.icon className="h-4 w-4 text-ink-3" /> {it.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      title={theme === "dark" ? "Passer en clair" : "Passer en sombre"}
      aria-label="Changer de theme"
      className="rounded-lg border border-line bg-surface-2 p-2 text-ink-3 transition hover:bg-hover hover:text-ink"
    >
      {theme === "dark" ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}

const navLinkCls = (active: boolean) =>
  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
    active ? "bg-accent/15 text-accent font-medium" : "text-ink-3 hover:bg-hover hover:text-ink"
  }`;

export default function Layout() {
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const isActive = (to: string) => (to === "/" ? pathname === "/" : pathname.startsWith(to));

  return (
    <div className="min-h-screen bg-app">
      {/* Barre laterale - bureau */}
      <aside className="no-print fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-line bg-surface lg:flex">
        <div className="flex items-center gap-3 px-5 py-5">
          <img src="/logo.png" alt="PaletteD&co" className="h-10 w-10 rounded-lg object-contain" />
          <CompanyName />
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-3">
          {navItems.map((it) => (
            <Link key={it.to} to={it.to} className={navLinkCls(isActive(it.to))}>
              <it.icon className="h-4 w-4 shrink-0" />
              {it.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-line px-3 py-3">
          <button
            onClick={() => {
              clearSession();
              location.href = "/";
            }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-ink-3 transition hover:bg-hover hover:text-ink"
          >
            <LogOut className="h-4 w-4" /> Se deconnecter
          </button>
        </div>
      </aside>

      {/* Contenu */}
      <div className="lg:pl-60">
        <header className="no-print sticky top-0 z-30 border-b border-line bg-app/95 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-3">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Menu"
              className="rounded-lg border border-line bg-surface-2 p-2 text-ink-3 lg:hidden"
            >
              {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
            <div className="flex min-w-0 items-center gap-2.5 lg:hidden">
              <img src="/logo.png" alt="PaletteD&co" className="h-8 w-8 rounded-lg object-contain" />
              <span className="truncate font-display text-base font-semibold">PaletteD&co</span>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <div className="hidden sm:block">
                <PeriodSelect />
              </div>
              <ThemeToggle />
              <QuickCreate />
            </div>
          </div>
          <div className="px-4 pb-3 sm:hidden">
            <PeriodSelect />
          </div>

          {menuOpen && (
            <nav className="border-t border-line bg-surface px-3 py-2 lg:hidden">
              {navItems.map((it) => (
                <Link key={it.to} to={it.to} className={navLinkCls(isActive(it.to))}>
                  <it.icon className="h-4 w-4" />
                  {it.label}
                </Link>
              ))}
            </nav>
          )}
        </header>

        <main className="mx-auto max-w-6xl px-4 pb-24 pt-5 lg:px-8 lg:pb-12">
          <Outlet />
        </main>
      </div>

      {/* Barre de navigation - mobile */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-line bg-app/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <div className="grid grid-cols-5">
          {navItems.slice(0, 5).map((it) => (
            <Link
              key={it.to}
              to={it.to}
              className={`flex flex-col items-center gap-0.5 py-2 text-[10px] ${isActive(it.to) ? "text-accent" : "text-ink-4"}`}
            >
              <it.icon className="h-5 w-5" />
              {it.short}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}