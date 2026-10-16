/**
 * Synchronisation Tresorerie <-> Depenses / Encaissements.
 *
 * Modele du projet : deux univers d'argent.
 *   - « metier »  : expenses (depenses fournisseurs) et payments (reglements clients)
 *   - « banque »  : bank_transactions (mouvements qui alimentent la page Tresorerie
 *                   et le KPI « tresorerie nette »)
 *
 * Ce module fait le pont : chaque depense et chaque encaissement cree / met a jour /
 * supprime automatiquement le mouvement bancaire correspondant, afin que les deux
 * ecrans restent coherents sans double saisie.
 *
 * Les fonctions prennent le pool en parametre : le module est partage par index.ts
 * et cockpit.ts sans dependance circulaire.
 */
import type { Pool } from "pg";

export type ExpenseRow = {
  id: number;
  expense_date: string;
  supplier: string | null;
  label: string | null;
  reference: string | null;
  amount_ttc: number | string;
  account_id: number | null;
};

export type PaymentRow = {
  id: number;
  invoice_id: number;
  amount: number | string;
  date: string;
};

/** Compte bancaire a utiliser par defaut : le compte marque is_default, sinon le premier actif. */
export async function defaultBankAccountId(pool: Pool): Promise<number | null> {
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM bank_accounts WHERE archived = false ORDER BY is_default DESC, sort_order, id LIMIT 1`,
  );
  return rows.length ? rows[0].id : null;
}

function expenseLabel(e: ExpenseRow): string {
  const label = (e.label || "").trim();
  if (label) return label;
  return e.supplier ? `Depense - ${e.supplier}` : `Depense #${e.id}`;
}

/**
 * Cree ou met a jour le mouvement bancaire lie a une depense (sortie, kind='expense').
 * Si la depense n'a pas de compte, le mouvement est cree sans compte : il compte
 * dans le KPI « tresorerie nette » sans peser sur le solde d'un compte precis.
 */
export async function syncExpenseTransaction(pool: Pool, e: ExpenseRow): Promise<void> {
  const label = expenseLabel(e);
  const amount = Math.abs(Number(e.amount_ttc) || 0);
  const accountId = e.account_id ?? null;
  const txDate = e.expense_date || null;
  const reference = e.reference || "";
  const existing = await pool.query<{ id: number }>(
    "SELECT id FROM bank_transactions WHERE expense_id = $1 ORDER BY id LIMIT 1",
    [e.id],
  );
  if (existing.rows.length) {
    await pool.query(
      `UPDATE bank_transactions
          SET account_id = $1, tx_date = coalesce($2::date, CURRENT_DATE), label = $3, amount = $4, reference = $5
        WHERE id = $6`,
      [accountId, txDate, label, amount, reference, existing.rows[0].id],
    );
  } else {
    await pool.query(
      `INSERT INTO bank_transactions (account_id, tx_date, label, amount, direction, kind, expense_id, reference)
       VALUES ($1, coalesce($2::date, CURRENT_DATE), $3, $4, 'out', 'expense', $5, $6)`,
      [accountId, txDate, label, amount, e.id, reference],
    );
  }
}

/** Supprime le(s) mouvement(s) bancaire(s) generes pour une depense. */
export async function removeExpenseTransaction(pool: Pool, expenseId: number): Promise<void> {
  await pool.query("DELETE FROM bank_transactions WHERE expense_id = $1", [expenseId]);
}

/**
 * Cree le mouvement bancaire lie a un encaissement (entree, kind='payment').
 * Utilise le compte fourni, sinon le compte par defaut, sinon aucun compte.
 */
export async function syncPaymentTransaction(
  pool: Pool,
  p: PaymentRow,
  invoiceNumber: string | null,
  clientId: number | null,
  accountId: number | null,
): Promise<void> {
  const label = invoiceNumber ? `Encaissement ${invoiceNumber}` : `Encaissement #${p.id}`;
  const account = accountId ?? (await defaultBankAccountId(pool));
  await pool.query(
    `INSERT INTO bank_transactions (account_id, tx_date, label, amount, direction, kind, client_id, invoice_id, payment_id, reference)
     VALUES ($1, coalesce($2::date, CURRENT_DATE), $3, $4, 'in', 'payment', $5, $6, $7, '')`,
    [account, p.date || null, label, Math.abs(Number(p.amount) || 0), clientId, p.invoice_id, p.id],
  );
}

/** Supprime le mouvement bancaire genere pour un encaissement. */
export async function removePaymentTransaction(pool: Pool, paymentId: number): Promise<void> {
  await pool.query("DELETE FROM bank_transactions WHERE payment_id = $1", [paymentId]);
}
