-- Dossiers : un dossier peut aussi contenir des factures (devis + factures
-- d'un meme client/projet). 100% additif.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES quote_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_group ON invoices(group_id);
