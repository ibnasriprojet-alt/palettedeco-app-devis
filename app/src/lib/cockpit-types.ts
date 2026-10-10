/** Types du cockpit de gestion (depenses, tresorerie, relances, avoirs). */

export type AppSettings = {
  email_mode: "test" | "live";
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

export type Expense = {
  id: number;
  expense_date: string;
  supplier: string;
  category: string;
  label: string;
  reference: string;
  amount_ht: number | string;
  tva_rate: number | string;
  amount_ttc: number | string;
  account_id: number | null;
  account_name?: string | null;
  payment_method: string;
  deductible_tva: boolean;
  notes: string;
  created_at: string;
};

export type ExpenseInput = Partial<Omit<Expense, "id" | "created_at" | "account_name">>;

export type BankAccount = {
  id: number;
  name: string;
  bank_name: string;
  iban: string;
  bic: string;
  currency: string;
  opening_balance: number | string;
  opening_date: string;
  is_default: boolean;
  archived: boolean;
  solde?: number | string;
  total_net?: number | string;
  period_net?: number | string;
  before_period?: number | string;
  opening?: number | string;
};

export type BankTransaction = {
  id: number;
  account_id: number | null;
  account_name?: string | null;
  tx_date: string;
  value_date: string | null;
  label: string;
  amount: number | string;
  direction: "in" | "out";
  kind: string;
  client_id: number | null;
  client_name?: string | null;
  invoice_id: number | null;
  invoice_number?: string | null;
  expense_id: number | null;
  expense_label?: string | null;
  expense_supplier?: string | null;
  reference: string;
  reconciled: boolean;
};

export type Kpi = {
  range: { from: string; to: string };
  ca_ttc: number | string;
  ca_ht: number | string;
  factures_count: number;
  encaissements: number | string;
  encaissements_count: number;
  a_encaisser_count: number;
  a_encaisser_reste: number | string;
  en_retard_count: number;
  en_retard_reste: number | string;
  pire_retard_jours: number;
  depenses_ttc: number | string;
  depenses_ht: number | string;
  depenses_count: number;
  tresorerie_nette: number | string;
  top_clients: { id: number; client: string; ca: number | string; factures: number }[];
  serie: { ym: string; ca: number | string; encaissements: number | string; depenses: number | string }[];
  evolution: { ca: number | null; encaissements: number | null; depenses: number | null } | null;
};

export type ReminderTemplate = {
  id?: number;
  level: number;
  label: string;
  subject: string;
  body: string;
  delay_days: number;
  tone: string;
  active: boolean;
  is_default?: boolean;
};

export type ReminderTarget = {
  id: number;
  number: string;
  status: string;
  issue_date: string;
  due_date: string;
  total_ttc: number | string;
  paid: number | string;
  reste: number | string;
  retard_jours: number;
  en_retard: boolean;
  relances_envoyees: number;
  client_id: number | null;
  client: string;
  email: string | null;
  niveau_atteint: number | null;
  niveau_suivant: number | null;
  libelle_suivant: string | null;
  relance_pausee?: boolean;
  client_sans_relance?: boolean;
  actionnable: boolean;
};

export type ReminderPreview = {
  level: number;
  label: string;
  subject: string;
  body: string;
  to_client: string;
  to_final: string;
  redirected: boolean;
  mode: "test" | "live";
};

export type ReminderLog = {
  id: number;
  invoice_id: number;
  level: number;
  channel: string;
  to_email: string;
  subject: string;
  status: "draft" | "queued" | "sent" | "failed";
  sent_at: string | null;
  error: string;
  redirected_to_test: boolean;
  created_at: string;
  invoice_number?: string;
  client?: string;
};

export type ComplianceCheck = { key: string; label: string; ok: boolean };

export const EXPENSE_CATEGORIES = [
  { id: "fournisseur", label: "Matieres et fournisseurs" },
  { id: "sous_traitance", label: "Sous-traitance" },
  { id: "transport", label: "Transport et livraison" },
  { id: "energie", label: "Energie et fluides" },
  { id: "loyer", label: "Loyer et charges" },
  { id: "assurance", label: "Assurances" },
  { id: "outillage", label: "Outillage et machines" },
  { id: "logiciel", label: "Logiciels et abonnements" },
  { id: "marketing", label: "Marketing et communication" },
  { id: "salaire", label: "Salaires et cotisations" },
  { id: "taxe", label: "Taxes et impots" },
  { id: "autre", label: "Autre" },
];

export const PAYMENT_METHODS = [
  { id: "virement", label: "Virement" },
  { id: "carte", label: "Carte bancaire" },
  { id: "cheque", label: "Cheque" },
  { id: "especes", label: "Especes" },
  { id: "prelevement", label: "Prelevement" },
  { id: "other", label: "Autre" },
];

export const TX_KINDS = [
  { id: "payment", label: "Encaissement client" },
  { id: "expense", label: "Depense" },
  { id: "transfer", label: "Virement interne" },
  { id: "fee", label: "Frais bancaires" },
  { id: "tax", label: "Impots et taxes" },
  { id: "salary", label: "Salaires" },
  { id: "other", label: "Autre" },
];