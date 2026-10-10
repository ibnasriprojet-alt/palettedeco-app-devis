-- Suspendre une relance sur une facture, exclure un client des relances.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reminder_paused BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS no_reminders BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_invoices_reminder_paused ON invoices(reminder_paused);