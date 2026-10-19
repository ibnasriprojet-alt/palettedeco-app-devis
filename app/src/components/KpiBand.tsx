import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ArrowDownRight, ArrowUpRight, Landmark, TrendingUp, Users, Wallet } from "lucide-react";
import { api } from "../lib/api";
import type { Kpi as KpiType } from "../lib/cockpit-types";
import { eur, usePeriod, variation } from "../lib/period";
import { cn } from "../lib/cn";

/**
 * Bandeau d'indicateurs du cockpit : chiffre d'affaires, encaissements,
 * factures a encaisser / en retard, tresorerie, depenses, top clients.
 * Tout est pilote par le selecteur de periode de l'en-tete.
 */
export function KpiBand() {
  const { range, previousRange, period } = usePeriod();
  const [kpi, setKpi] = useState<KpiType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .getKpi({
        from: range.from,
        to: range.to,
        prev_from: previousRange.from,
        prev_to: previousRange.to,
      })
      .then((k) => {
        if (alive) {
          setKpi(k);
          setError("");
        }
      })
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [range.from, range.to, previousRange.from, previousRange.to]);

  const maxSerie = useMemo(() => {
    const s = kpi?.serie || [];
    return Math.max(1, ...s.flatMap((m) => [Number(m.ca) || 0, Number(m.encaissements) || 0, Number(m.depenses) || 0]));
  }, [kpi]);

  const cards = [
    {
      key: "ca",
      label: "Chiffre d'affaires TTC",
      value: kpi?.ca_ttc ?? 0,
      delta: kpi?.evolution?.ca ?? null,
      icon: TrendingUp,
      hint: `${kpi?.factures_count ?? 0} facture(s) sur la période`,
      to: "/invoices",
    },
    {
      key: "enc",
      label: "Encaissements",
      value: kpi?.encaissements ?? 0,
      delta: kpi?.evolution?.encaissements ?? null,
      icon: ArrowUpRight,
      hint: `${kpi?.encaissements_count ?? 0} règlement(s)`,
      to: "/cash",
    },
    {
      key: "att",
      label: "Factures à encaisser",
      value: kpi?.a_encaisser_reste ?? 0,
      delta: null,
      icon: Wallet,
      hint: `${kpi?.a_encaisser_count ?? 0} facture(s) non soldée(s)`,
      to: "/invoices",
    },
    {
      key: "retard",
      label: "En retard",
      value: kpi?.en_retard_reste ?? 0,
      delta: null,
      icon: AlertCircle,
      danger: true,
      hint:
        (kpi?.en_retard_count ?? 0) > 0
          ? `${kpi?.en_retard_count} facture(s) · pire retard ${kpi?.pire_retard_jours ?? 0} j`
          : "Aucun retard",
      to: "/relances",
    },
    {
      key: "treso",
      label: "Trésorerie nette",
      value: kpi?.tresorerie_nette ?? 0,
      delta: null,
      icon: Landmark,
      hint: "Entrées moins sorties de la période",
      to: "/cash",
    },
    {
      key: "dep",
      label: "Dépenses",
      value: kpi?.depenses_ttc ?? 0,
      delta: kpi?.evolution?.depenses ?? null,
      icon: ArrowDownRight,
      inverse: true,
      hint: `${kpi?.depenses_count ?? 0} dépense(s) fournisseur`,
      to: "/expenses",
    },
  ];

  if (loading) {
    return (
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl border border-line bg-surface" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="mb-4 rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger">
        Indicateurs indisponibles : {error}
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.key}
            to={c.to}
            className="group rounded-xl border border-line bg-surface p-4 transition hover:border-accent/40 hover:bg-surface-2"
          >
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-ink-4">
              <c.icon className="h-3.5 w-3.5" />
              <span className="truncate">{c.label}</span>
            </div>
            <div
              className={cn(
                "mt-1.5 text-xl font-semibold tabular-nums sm:text-2xl",
                c.danger && Number(c.value) > 0 && "text-danger",
              )}
            >
              {eur(c.value)}
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-ink-4">
              {c.delta != null && (
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 font-medium",
                    (c.delta >= 0) !== !!c.inverse ? "text-success" : "text-danger",
                  )}
                >
                  {c.delta >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                  {Math.abs(c.delta).toFixed(1)} %
                </span>
              )}
              <span className="truncate">{c.hint}</span>
            </div>
          </Link>
        ))}
      </div>

      {/* Graphique 12 mois + top clients */}
      <div className="mb-4 grid gap-3 lg:grid-cols-3">
        <Card2 className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Activité sur 12 mois</h3>
            <div className="flex gap-3 text-xs text-ink-4">
              <Legend color="bg-accent" label="CA" />
              <Legend color="bg-success" label="Encaissé" />
              <Legend color="bg-brand-2" label="Dépenses" />
            </div>
          </div>
          <div className="flex h-36 items-end gap-1.5">
            {(kpi?.serie || []).map((m) => {
              const ca = Number(m.ca) || 0;
              const enc = Number(m.encaissements) || 0;
              const dep = Number(m.depenses) || 0;
              return (
                <div key={m.ym} className="group relative flex min-w-0 flex-1 flex-col items-center justify-end gap-0.5">
                  <div className="absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-surface px-2 py-1 text-xs shadow group-hover:block">
                    <div>{m.ym}</div>
                    <div>CA : {eur(ca)}</div>
                    <div>Encaissé : {eur(enc)}</div>
                    <div>Dépenses : {eur(dep)}</div>
                  </div>
                  <div className="flex w-full flex-1 items-end justify-center gap-px">
                    <div className="w-1/3 rounded-t bg-accent" style={{ height: `${(ca / maxSerie) * 100}%` }} />
                    <div className="w-1/3 rounded-t bg-success" style={{ height: `${(enc / maxSerie) * 100}%` }} />
                    <div className="w-1/3 rounded-t bg-brand-2" style={{ height: `${(dep / maxSerie) * 100}%` }} />
                  </div>
                  <div className="mt-1 hidden text-[9px] capitalize text-ink-4 sm:block">{m.ym.slice(5)}/{m.ym.slice(2, 4)}</div>
                </div>
              );
            })}
          </div>
        </Card2>

        <Card2>
          <h3 className="mb-3 font-display text-base font-semibold">Meilleurs clients</h3>
          {(kpi?.top_clients || []).length === 0 ? (
            <p className="text-sm text-ink-4">
              {period === "30d" || period === "month"
                ? "Aucune facture sur cette période. Élargissez la période dans l'en-tête."
                : "Aucune facture sur la période."}
            </p>
          ) : (
            <ol className="space-y-2">
              {(kpi?.top_clients || []).slice(0, 6).map((c, i) => (
                <li key={c.id ?? i} className="flex items-center gap-2 text-sm">
                  <Users className="h-3.5 w-3.5 shrink-0 text-ink-4" />
                  <span className="min-w-0 flex-1 truncate">{c.client}</span>
                  <span className="shrink-0 font-medium tabular-nums">{eur(c.ca)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card2>
      </div>
    </>
  );
}

function Card2({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("min-w-0 rounded-xl border border-line bg-surface p-4", className)}>{children}</div>;
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("h-2 w-2 rounded-full", color)} />
      {label}
    </span>
  );
}

/** Reutilise le calcul de variation ailleurs dans l'application. */
export { variation };