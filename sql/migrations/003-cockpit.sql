-- PaletteD&co - Migration 003 "cockpit de gestion"
-- REGLE ABSOLUE : ce script est 100% additif.
--   - uniquement CREATE TABLE IF NOT EXISTS et ALTER TABLE ... ADD COLUMN IF NOT EXISTS
--   - aucun DROP, aucun DELETE, aucun TRUNCATE, aucun UPDATE destructif
--   - les lignes existantes (clients, devis, factures, reglements) sont conservees
--   - scripts/migrate.mjs refuse ce fichier s'il detecte un mot interdit
-- Rejouable autant de fois voulu.

-- ============================================================
-- 1. Reglages globaux de l'application (mode Test / mode Reel)
-- ============================================================
CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  email_mode TEXT NOT NULL DEFAULT 'test' CHECK (email_mode IN ('test','live')),
  test_email TEXT NOT NULL DEFAULT '',
  live_enabled_at TIMESTAMPTZ,
  invoice_prefix TEXT NOT NULL DEFAULT 'FACT',
  credit_note_prefix TEXT NOT NULL DEFAULT 'AVOIR',
  quote_prefix TEXT NOT NULL DEFAULT 'DEV',
  quote_validity_days INTEGER NOT NULL DEFAULT 30,
  default_payment_terms_days INTEGER NOT NULL DEFAULT 30,
  due_rule TEXT NOT NULL DEFAULT 'end_of_month_30' CHECK (due_rule IN ('end_of_month_30','days_30','net_15')),
  late_penalty_rate NUMERIC(5,2) NOT NULL DEFAULT 10,
  recovery_fee NUMERIC(12,2) NOT NULL DEFAULT 40,
  reminder_levels TEXT NOT NULL DEFAULT '[7,15,30]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO app_settings (id, email_mode) VALUES (1, 'test') ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2. Comptes bancaires et tresorerie
-- ============================================================
CREATE TABLE IF NOT EXISTS bank_accounts (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  bank_name TEXT DEFAULT '',
  iban TEXT DEFAULT '',
  bic TEXT DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'EUR',
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  opening_date DATE NOT NULL DEFAULT CURRENT_DATE,
  is_default BOOLEAN NOT NULL DEFAULT false,
  archived BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  supplier TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'fournisseur',
  label TEXT NOT NULL DEFAULT '',
  reference TEXT DEFAULT '',
  amount_ht NUMERIC(12,2) NOT NULL DEFAULT 0,
  tva_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  amount_ttc NUMERIC(12,2) NOT NULL DEFAULT 0,
  account_id INTEGER REFERENCES bank_accounts(id) ON DELETE SET NULL,
  payment_method TEXT NOT NULL DEFAULT 'virement' CHECK (payment_method IN ('virement','carte','cheque','especes','prelevement','other')),
  deductible_tva BOOLEAN NOT NULL DEFAULT false,
  notes TEXT DEFAULT '',
  attachment TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id SERIAL PRIMARY KEY,
  account_id INTEGER REFERENCES bank_accounts(id) ON DELETE SET NULL,
  tx_date DATE NOT NULL DEFAULT CURRENT_DATE,
  value_date DATE,
  label TEXT NOT NULL DEFAULT '',
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  direction TEXT NOT NULL DEFAULT 'in' CHECK (direction IN ('in','out')),
  kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('payment','expense','transfer','fee','tax','salary','other')),
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
  reference TEXT DEFAULT '',
  reconciled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 3. Avoirs : seul document autorise a corriger une facture finalisee
-- ============================================================
CREATE TABLE IF NOT EXISTS credit_notes (
  id SERIAL PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reason TEXT NOT NULL DEFAULT 'Correction',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued')),
  total_ht NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_tva NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_ttc NUMERIC(12,2) NOT NULL DEFAULT 0,
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_note_items (
  id SERIAL PRIMARY KEY,
  credit_note_id INTEGER NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
  invoice_item_id INTEGER REFERENCES invoice_items(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  quantity NUMERIC(12,3) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  tva_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  align TEXT NOT NULL DEFAULT 'left',
  bold BOOLEAN NOT NULL DEFAULT false,
  italic BOOLEAN NOT NULL DEFAULT false,
  is_block BOOLEAN NOT NULL DEFAULT false
);

-- ============================================================
-- 4. Centre de relances
-- ============================================================
CREATE TABLE IF NOT EXISTS reminder_templates (
  id SERIAL PRIMARY KEY,
  level INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  delay_days INTEGER NOT NULL DEFAULT 7,
  tone TEXT NOT NULL DEFAULT 'rappel' CHECK (tone IN ('rappel','mise_en_demeure','contentieux')),
  active BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (level)
);

CREATE TABLE IF NOT EXISTS reminders (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  template_id INTEGER REFERENCES reminder_templates(id) ON DELETE SET NULL,
  level INTEGER NOT NULL DEFAULT 1,
  channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email','courrier')),
  to_email TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','queued','sent','failed')),
  sent_at TIMESTAMPTZ,
  provider_message_id TEXT DEFAULT '',
  error TEXT DEFAULT '',
  redirected_to_test BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 5. Enrichissement des tables existantes (colonnes optionnelles)
-- ============================================================
-- Identifiants legaux obligatoires sur un document
ALTER TABLE company ADD COLUMN IF NOT EXISTS legal_name TEXT DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS siren TEXT DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS rcs TEXT DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS legal_form TEXT DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS share_capital NUMERIC(14,2);
ALTER TABLE company ADD COLUMN IF NOT EXISTS ape TEXT DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS address2 TEXT DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS zip_code TEXT DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS city TEXT DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'France';
ALTER TABLE company ADD COLUMN IF NOT EXISTS insurance TEXT DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS default_terms_days INTEGER NOT NULL DEFAULT 30;
ALTER TABLE company ADD COLUMN IF NOT EXISTS late_penalty_rate NUMERIC(5,2) NOT NULL DEFAULT 10;
ALTER TABLE company ADD COLUMN IF NOT EXISTS recovery_fee NUMERIC(12,2) NOT NULL DEFAULT 40;

ALTER TABLE clients ADD COLUMN IF NOT EXISTS code TEXT DEFAULT '';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS default_terms_days INTEGER NOT NULL DEFAULT 30;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS payment_delay INTEGER NOT NULL DEFAULT 0;

-- Facture : verrouillage de la finalisation, donnees de livraison, Factur-X
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS finalized BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS delivery_date DATE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS delivery_address TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS purchase_order TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS due_rule TEXT NOT NULL DEFAULT 'end_of_month_30';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS facturx_xml TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS facturx_level TEXT NOT NULL DEFAULT 'basic-wl';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS legal_note TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS remainder_sent_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS finalized BOOLEAN NOT NULL DEFAULT false;

-- Index de lecture du cockpit (aucune ecriture)
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_supplier ON expenses(supplier);
CREATE INDEX IF NOT EXISTS idx_bank_tx_date ON bank_transactions(tx_date);
CREATE INDEX IF NOT EXISTS idx_bank_tx_account ON bank_transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_bank_tx_client ON bank_transactions(client_id);
CREATE INDEX IF NOT EXISTS idx_reminders_invoice ON reminders(invoice_id);
CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status);
CREATE INDEX IF NOT EXISTS idx_invoices_due ON invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_invoice ON credit_notes(invoice_id);

-- Compteur de numerotation des avoirs (les factures utilisent deja 'invoice')
INSERT INTO counters (kind, value) SELECT 'credit_note', 0 WHERE NOT EXISTS (SELECT 1 FROM counters WHERE kind = 'credit_note');
