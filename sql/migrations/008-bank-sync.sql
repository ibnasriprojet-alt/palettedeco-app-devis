-- ============================================================
-- Synchronisation Tresorerie <-> Depenses / Encaissements
--
-- Un mouvement bancaire peut desormais etre genere automatiquement :
--   - a partir d'une depense  -> bank_transactions.expense_id (deja present)
--   - a partir d'un encaissement -> bank_transactions.payment_id (nouveau)
--
-- ON DELETE CASCADE : la suppression d'un reglement (ou de la facture qui le
-- porte) supprime le mouvement bancaire associe, pour rester synchrone.
-- ============================================================

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS payment_id INTEGER REFERENCES payments(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_bank_tx_payment ON bank_transactions(payment_id);
CREATE INDEX IF NOT EXISTS idx_bank_tx_expense ON bank_transactions(expense_id);
