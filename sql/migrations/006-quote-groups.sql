-- Dossiers de devis : regrouper plusieurs variantes d'un meme produit/projet
-- (caracteristiques et prix differents), puis designer la variante choisie.
-- Un dossier appartient a un seul client. 100% additif.

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

-- Rattachement d'un devis a un dossier (facultatif : un devis sans dossier reste autonome).
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES quote_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quotes_group ON quotes(group_id);
CREATE INDEX IF NOT EXISTS idx_quote_groups_client ON quote_groups(client_id);
