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

/* toISOString() convertit en UTC : entre 00h00 et 02h00 en France un document
   crees "aujourd'hui" serait date de la veille. On formate en heure locale. */
function localISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localISO(d);
}

export function today(): string {
  return localISO(new Date());
}

export function round2(n: string | number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}