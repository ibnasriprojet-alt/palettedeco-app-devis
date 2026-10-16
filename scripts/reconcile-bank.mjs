/**
 * Reconciliation Tresorerie <-> encaissements / depenses existants.
 *
 * Les ecritures creees AVANT la synchronisation automatique n'ont pas de
 * mouvement bancaire lie. Ce script rattrape le retard, sans jamais creer de
 * doublon :
 *   1. il tente de RELIER chaque encaissement / depense a un mouvement manuel
 *      deja saisi (meme montant, meme sens, non rattache) ;
 *   2. sinon il CREE le mouvement manquant.
 *
 * Idempotent : on peut le relancer autant de fois que necessaire.
 *
 *   node scripts/reconcile-bank.mjs                # base de .env.local
 *   node scripts/reconcile-bank.mjs --env=.env.dev
 *   node scripts/reconcile-bank.mjs --dry          # simulation, rien n'est ecrit
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const envFlag = args.find((a) => a.startsWith("--env="));
const dry = args.includes("--dry");

const envFile = join(root, envFlag ? envFlag.slice(6) : ".env.local");
if (!existsSync(envFile)) {
  console.error(`Fichier d'environnement introuvable : ${envFile}`);
  process.exit(1);
}
for (const line of readFileSync(envFile, "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL manquant dans le fichier d'environnement.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

const summary = { linked: 0, created: 0 };

try {
  await client.query("BEGIN");

  const acct = (
    await client.query(
      `SELECT id FROM bank_accounts WHERE archived = false ORDER BY is_default DESC, sort_order, id LIMIT 1`,
    )
  ).rows[0]?.id ?? null;

  /* 1. Encaissements (reglements clients) --------------------------------- */
  const payments = (
    await client.query(
      `SELECT p.id, p.invoice_id, p.amount, p.date, i.number AS invoice_number, i.client_id
         FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id
        WHERE NOT EXISTS (SELECT 1 FROM bank_transactions t WHERE t.payment_id = p.id)
        ORDER BY p.id`,
    )
  ).rows;

  for (const p of payments) {
    const match = (
      await client.query(
        `SELECT id FROM bank_transactions t
          WHERE t.payment_id IS NULL AND t.direction = 'in' AND t.kind = 'payment'
            AND abs(t.amount - $1) < 0.005
            AND (t.invoice_id IS NULL OR t.invoice_id = $2)
          ORDER BY abs(t.tx_date - $3::date), t.id
          LIMIT 1`,
        [p.amount, p.invoice_id, p.date],
      )
    ).rows[0];
    if (match) {
      await client.query(
        `UPDATE bank_transactions
            SET payment_id = $1, invoice_id = coalesce(invoice_id, $2), client_id = coalesce(client_id, $3)
          WHERE id = $4`,
        [p.id, p.invoice_id, p.client_id, match.id],
      );
      summary.linked++;
      console.log(`  encaissement #${p.id} (${p.amount} EUR ${p.invoice_number || ""}) -> mouvement #${match.id} [relie]`);
    } else {
      const label = p.invoice_number ? `Encaissement ${p.invoice_number}` : `Encaissement #${p.id}`;
      const ins = await client.query(
        `INSERT INTO bank_transactions (account_id, tx_date, label, amount, direction, kind, client_id, invoice_id, payment_id, reference)
         VALUES ($1, coalesce($2::date, CURRENT_DATE), $3, $4, 'in', 'payment', $5, $6, $7, '')
         RETURNING id`,
        [acct, p.date, label, Math.abs(Number(p.amount)), p.client_id, p.invoice_id, p.id],
      );
      summary.created++;
      console.log(`  encaissement #${p.id} (${p.amount} EUR ${p.invoice_number || ""}) -> mouvement #${ins.rows[0].id} [cree]`);
    }
  }

  /* 2. Depenses fournisseurs ---------------------------------------------- */
  const expenses = (
    await client.query(
      `SELECT e.id, e.expense_date, e.supplier, e.label, e.reference, e.amount_ttc, e.account_id
         FROM expenses e
        WHERE NOT EXISTS (SELECT 1 FROM bank_transactions t WHERE t.expense_id = e.id)
        ORDER BY e.id`,
    )
  ).rows;

  for (const e of expenses) {
    const match = (
      await client.query(
        `SELECT id FROM bank_transactions t
          WHERE t.expense_id IS NULL AND t.direction = 'out' AND t.kind = 'expense'
            AND abs(t.amount - $1) < 0.005
            AND (t.account_id = $2 OR t.account_id IS NULL OR $2 IS NULL)
          ORDER BY abs(t.tx_date - $3::date), t.id
          LIMIT 1`,
        [e.amount_ttc, e.account_id, e.expense_date],
      )
    ).rows[0];
    if (match) {
      await client.query(
        `UPDATE bank_transactions SET expense_id = $1, account_id = coalesce(account_id, $2) WHERE id = $3`,
        [e.id, e.account_id, match.id],
      );
      summary.linked++;
      console.log(`  depense #${e.id} (${e.amount_ttc} EUR ${e.supplier}) -> mouvement #${match.id} [relie]`);
    } else {
      const label = (e.label || "").trim() || (e.supplier ? `Depense - ${e.supplier}` : `Depense #${e.id}`);
      const ins = await client.query(
        `INSERT INTO bank_transactions (account_id, tx_date, label, amount, direction, kind, expense_id, reference)
         VALUES ($1, coalesce($2::date, CURRENT_DATE), $3, $4, 'out', 'expense', $5, $6)
         RETURNING id`,
        [e.account_id ?? acct, e.expense_date, label, Math.abs(Number(e.amount_ttc)), e.id, e.reference || ""],
      );
      summary.created++;
      console.log(`  depense #${e.id} (${e.amount_ttc} EUR ${e.supplier}) -> mouvement #${ins.rows[0].id} [cree]`);
    }
  }

  if (dry) {
    await client.query("ROLLBACK");
    console.log("\n--dry : transaction annulee, aucune ecriture.");
  } else {
    await client.query("COMMIT");
  }

  console.log(
    `\nReconciliation : ${summary.linked} mouvement(s) relie(s), ${summary.created} mouvement(s) cree(s).${
      payments.length + expenses.length === 0 ? " Rien a faire : tout etait deja synchrone." : ""
    }`,
  );
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(`\nEchec, transaction annulee : ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
