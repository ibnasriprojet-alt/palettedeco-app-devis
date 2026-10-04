export function money(n: number | string | null | undefined): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });

export function fmt(n: number | string | null | undefined): string {
  return eur.format(money(n));
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const date = new Date(`${d}T00:00:00`);
  if (isNaN(date.getTime())) return d;
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function round2(n: string | number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}