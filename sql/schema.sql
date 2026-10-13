-- PaletteD&co - Schéma base de données
-- Devis et factures

CREATE TABLE IF NOT EXISTS company (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  name TEXT DEFAULT '',
  owner_name TEXT DEFAULT '',
  siret TEXT DEFAULT '',
  address TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  website TEXT DEFAULT '',
  iban TEXT DEFAULT '',
  bic TEXT DEFAULT '',
  logo TEXT DEFAULT '',
  default_tva_rate NUMERIC(5,2) NOT NULL DEFAULT 20,
  payment_terms TEXT DEFAULT E'Paiement accepté :\n- Virement\n- CB\n- Espèces',
  mentions TEXT DEFAULT '',
  app_password TEXT DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE company ADD COLUMN IF NOT EXISTS app_password TEXT DEFAULT '';
ALTER TABLE company ADD COLUMN IF NOT EXISTS vat_number TEXT DEFAULT '';

INSERT INTO company (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  siret TEXT DEFAULT '',
  address TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE clients ADD COLUMN IF NOT EXISTS vat_number TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS quotes (
  id SERIAL PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','declined','invoiced')),
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '30 days'),
  conditions TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  total_ht NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_tva NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_ttc NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quote_items (
  id SERIAL PRIMARY KEY,
  quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  quantity NUMERIC(12,3) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  tva_rate NUMERIC(5,2) NOT NULL DEFAULT 20,
  align TEXT NOT NULL DEFAULT 'left',
  bold BOOLEAN NOT NULL DEFAULT false,
  italic BOOLEAN NOT NULL DEFAULT false,
  is_block BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','declined','invoiced')),
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '30 days'),
  conditions TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  total_ht NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_tva NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_ttc NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  quantity NUMERIC(12,3) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  tva_rate NUMERIC(5,2) NOT NULL DEFAULT 20,
  align TEXT NOT NULL DEFAULT 'left',
  bold BOOLEAN NOT NULL DEFAULT false,
  italic BOOLEAN NOT NULL DEFAULT false,
  is_block BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  quote_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','paid','partial')),
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '30 days'),
  conditions TEXT DEFAULT '',
  total_ht NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_tva NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_ttc NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  quantity NUMERIC(12,3) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  tva_rate NUMERIC(5,2) NOT NULL DEFAULT 20,
  align TEXT NOT NULL DEFAULT 'left',
  bold BOOLEAN NOT NULL DEFAULT false,
  italic BOOLEAN NOT NULL DEFAULT false,
  is_block BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS counters (
  kind TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  method TEXT DEFAULT '',
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);

CREATE INDEX IF NOT EXISTS idx_quotes_client ON quotes(client_id);
CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items(quote_id);
CREATE INDEX IF NOT EXISTS idx_invoices_quote ON invoices(quote_id);

-- Colonnes de personnalisation text (ajout idempotent pour bases existantes)
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS photos JSONB NOT NULL DEFAULT '[]';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS photos JSONB NOT NULL DEFAULT '[]';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS photos JSONB NOT NULL DEFAULT '[]';
ALTER TABLE quote_items ADD COLUMN IF NOT EXISTS align TEXT NOT NULL DEFAULT 'left';
ALTER TABLE quote_items ADD COLUMN IF NOT EXISTS bold BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE quote_items ADD COLUMN IF NOT EXISTS italic BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE quote_items ADD COLUMN IF NOT EXISTS is_block BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL;

ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS align TEXT NOT NULL DEFAULT 'left';
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS bold BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS italic BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS is_block BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_orders_client ON orders(client_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- Backfill relié (factures existantes depuis un devis)
UPDATE invoices inv SET client_id = qt.client_id
FROM quotes qt
WHERE inv.client_id IS NULL AND qt.id = inv.quote_id AND qt.client_id IS NOT NULL;
-- Signataires reutilisables et signature des devis (migration 005)
CREATE TABLE IF NOT EXISTS signatories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT DEFAULT '',
  image TEXT DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS signed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS signed_by JSONB NOT NULL DEFAULT '[]';
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS signature_mention TEXT DEFAULT '';

-- Dossiers de devis : variantes d'un meme produit/projet pour un client.
CREATE TABLE IF NOT EXISTS quote_groups (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','chosen')),
  chosen_quote_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES quote_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quotes_group ON quotes(group_id);
CREATE INDEX IF NOT EXISTS idx_quote_groups_client ON quote_groups(client_id);

-- Un dossier peut aussi regrouper des factures (devis + factures du meme client/projet).
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES quote_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_group ON invoices(group_id);
