import { Link, Outlet } from "react-router-dom";
import { Palette, FileText, Users, ReceiptText, ClipboardList, Settings, LogOut } from "lucide-react";
import { clearSession } from "../pages/Login";

const navItems = [
  { to: "/", label: "Accueil", icon: Palette },
  { to: "/quotes", label: "Devis", icon: FileText },
  { to: "/orders", label: "Commandes", icon: ClipboardList },
  { to: "/clients", label: "Clients", icon: Users },
  { to: "/invoices", label: "Factures", icon: ReceiptText },
  { to: "/settings", label: "Réglages", icon: Settings },
];

export default function Layout() {
  return (
    <div className="min-h-screen">
      {/* Sidebar desktop */}
      <aside className="no-print hidden lg:flex fixed inset-y-0 left-0 w-60 flex-col border-r border-white/10 bg-[#251710]">
        <div className="flex items-center gap-3 px-5 py-5">
          <img src="/logo.png" alt="PaletteD&co" className="h-11 w-11 rounded-lg object-contain" />
          <div>
            <div className="font-semibold leading-tight">PaletteD&co</div>
            <div className="text-xs text-amber-400/80">Devis & Factures</div>
          </div>
        </div>
        <nav className="mt-2 flex flex-col gap-1 px-3">
          {navItems.map((it) => (
            <Link
              key={it.to}
              to={it.to}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-stone-300 transition hover:bg-white/10 hover:text-white"
            >
              <it.icon className="h-4 w-4" />
              {it.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto px-3 pb-4">
          <button
            onClick={() => {
              clearSession();
              location.href = "/";
            }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-stone-400 transition hover:bg-white/10 hover:text-white"
          >
            <LogOut className="h-4 w-4" /> Se déconnecter
          </button>
        </div>
      </aside>

      {/* Contenu */}
      <div className="lg:pl-60">
        <header className="no-print sticky top-0 z-30 flex items-center gap-2.5 border-b border-white/10 bg-[#1c130c]/95 px-4 py-3 backdrop-blur lg:hidden">
          <img src="/logo.png" alt="PaletteD&co" className="h-8 w-8 rounded-lg object-contain" />
          <span className="text-sm font-semibold">PaletteD&co</span>
          <span className="text-[11px] text-amber-400/80">Devis & Factures</span>
        </header>
        <main className="mx-auto max-w-5xl px-4 pb-28 pt-5 lg:px-8 lg:pb-12">
          <Outlet />
        </main>
      </div>

      {/* Navbar mobile */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#1c130c]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <div className="grid grid-cols-6">
          {navItems.map((it) => (
            <Link
              key={it.to}
              to={it.to}
              className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-stone-400"
            >
              <it.icon className="h-5 w-5" />
              {it.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}