import type pg from "pg";

export type EmailMode = "test" | "live";

export type AppSettings = {
  email_mode: EmailMode;
  test_email: string;
  live_enabled_at: string | null;
  invoice_prefix: string;
  credit_note_prefix: string;
  quote_prefix: string;
  quote_validity_days: number;
  default_payment_terms_days: number;
  due_rule: string;
  late_penalty_rate: number;
  recovery_fee: number;
  reminder_levels: string;
};

export const DEFAULT_SETTINGS: AppSettings = {
  email_mode: "test",
  test_email: "",
  live_enabled_at: null,
  invoice_prefix: "FACT",
  credit_note_prefix: "AVOIR",
  quote_prefix: "DEV",
  quote_validity_days: 30,
  default_payment_terms_days: 30,
  due_rule: "end_of_month_30",
  late_penalty_rate: 10,
  recovery_fee: 40,
  reminder_levels: "[7,15,30]",
};

export async function loadAppSettings(pool: pg.Pool): Promise<AppSettings> {
  const { rows } = await pool.query("SELECT * FROM app_settings WHERE id = 1");
  if (!rows.length) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...rows[0] };
}

/**
 * Garde-fou central des e-mails.
 *
 * Tant que le mode n'est pas explicitement passe a "live", AUCUN message ne
 * part vers une adresse client reelle : tout est redirige vers l'adresse de
 * test. La fonction renvoie aussi l'information d'eventuelle redirection pour
 * que l'interface et la trace en base puissent l'afficher.
 */
export function resolveRecipient(
  settings: AppSettings,
  requested: string,
): { to: string; redirected: boolean; mode: EmailMode } {
  const target = String(requested || "").trim();
  if (settings.email_mode === "live") return { to: target, redirected: false, mode: "live" };
  const test = String(settings.test_email || "").trim();
  /* Mode test sans adresse de test : on bloque plutot que d'envoyer au client. */
  if (!test) return { to: "", redirected: true, mode: "test" };
  return { to: test, redirected: target !== test, mode: "test" };
}

/** Echappement XML : utilise par Factur-X et par les e-mails HTML. */
export function xmlEscape(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Date d'echeance : "30 jours fin de mois" = fin du mois suivant l'emission. */
export function dueDateFrom(issue: string, rule: string, termsDays = 30): string {
  const d = new Date(issue + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return issue;
  if (rule === "end_of_month_30") {
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    return end.toISOString().slice(0, 10);
  }
  if (rule === "net_15") {
    const r = new Date(d);
    r.setUTCDate(r.getUTCDate() + 15);
    return r.toISOString().slice(0, 10);
  }
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + (termsDays || 30));
  return r.toISOString().slice(0, 10);
}