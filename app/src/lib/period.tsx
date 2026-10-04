import { createContext, useContext, useMemo, useState } from "react";

/**
 * Periode d'analyse partagee par toutes les pages (KPI, graphiques, listes).
 * Un seul selecteur dans l'en-tete pilote tout l'ecran.
 */
export type PeriodId = "30d" | "month" | "quarter" | "12m";

export const PERIODS: { id: PeriodId; label: string; days: number }[] = [
  { id: "30d", label: "30 derniers jours", days: 30 },
  { id: "month", label: "Mois en cours", days: 31 },
  { id: "quarter", label: "Trimestre en cours", days: 92 },
  { id: "12m", label: "12 derniers mois", days: 365 },
];

export type Range = { from: string; to: string };

const iso = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Premier jour de la periode courante (bornes locales, pas UTC). */
export function periodRange(id: PeriodId): Range {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (id === "month") start.setDate(1);
  else if (id === "quarter") start.setMonth(Math.floor(start.getMonth() / 3) * 3, 1);
  else start.setDate(start.getDate() - (PERIODS.find((p) => p.id === id)?.days ?? 30) + 1);
  return { from: iso(start), to: iso(now) };
}

/** Douze derniers mois buckets pour un graphique, du plus ancien au plus recent. */
export function last12Months(): { key: string; label: string; from: string; to: string }[] {
  const out: { key: string; label: string; from: string; to: string }[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    out.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("fr-FR", { month: "short" }),
      from: iso(d),
      to: iso(end),
    });
  }
  return out;
}

const PeriodContext = createContext<{
  period: PeriodId;
  setPeriod: (p: PeriodId) => void;
  range: Range;
  previousRange: Range;
}>({ period: "12m", setPeriod: () => {}, range: periodRange("12m"), previousRange: periodRange("12m") });

export function PeriodProvider({ children }: { children: React.ReactNode }) {
  const [period, setPeriod] = useState<PeriodId>("12m");

  const value = useMemo(() => {
    const range = periodRange(period);
    /* Periode precedente de meme longueur : sert a la comparaison N-1 sur les KPI. */
    const days = Math.max(
      1,
      Math.round((new Date(range.to).getTime() - new Date(range.from).getTime()) / 86400000) + 1,
    );
    const prevTo = new Date(new Date(range.from).getTime() - 86400000);
    const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86400000);
    return { period, setPeriod, range, previousRange: { from: iso(prevFrom), to: iso(prevTo) } };
  }, [period]);

  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}

export function usePeriod() {
  return useContext(PeriodContext);
}

/** Formatage monetaire FR pour les KPI et graphiques. */
export function eur(n: number | string | null | undefined): string {
  const v = Number(n) || 0;
  return v.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
}

export function eurCompact(n: number | string | null | undefined): string {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " M€";
  if (Math.abs(v) >= 1_000) return (v / 1_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " k€";
  return eur(v);
}

/** Variation en % entre deux valeurs (null si la base est nulle). */
export function variation(current: number, previous: number): number | null {
  const a = Number(current) || 0;
  const b = Number(previous) || 0;
  if (b === 0) return null;
  return ((a - b) / Math.abs(b)) * 100;
}

export function usePeriodSetter(): (p: PeriodId) => void {
  return useContext(PeriodContext).setPeriod;
}