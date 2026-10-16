/**
 * Routes du cockpit de gestion : depenses, tresorerie, KPI, relances, avoirs.
 *
 * Toutes les lectures sont filtreees par une periode (from/to) et un filtres
 * de recherche. Aucun e-mail n'est envoye sans passer par resolveRecipient(),
 * qui redirige vers l'adresse de test tant que le mode Reel n'est pas actif.
 */
import type pg from "pg";
import { loadAppSettings, resolveRecipient, DEFAULT_SETTINGS, type AppSettings } from "./settings.js";
import { DEFAULT_REMINDER_TEMPLATES, type ReminderTemplate } from "./reminder-templates.js";
import { buildFacturxXml, type FxInvoice } from "./facturx.js";
import { syncExpenseTransaction, removeExpenseTransaction } from "./bank-sync.js";
import type { Hono } from "hono";

type Ctx = {
  req: { param(k: string): string; query(k: string): string; json(): Promise<any> };
  json(b: unknown, s?: any): Response;
};

type Deps = {
  app: Hono;
  pool: pg.Pool;
  loadCompany(): Promise<Record<string, any>>;
  moneyStr(v: unknown): string;
  sendMail(args: {
    to: string;
    subject: string;
    text: string;
    attachment?: { filename: string; content: string };
  }): Promise<{ id?: string; via: string }>;
};

const num = (v: unknown, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const today = () => new Date().toISOString().slice(0, 10);
const iso = (d: Date) => d.toISOString().slice(0, 10);

function dateRange(c: Ctx): { from: string; to: string } {
  const from = c.req.query("from") || iso(new Date(Date.now() - 364 * 86400000));
  const to = c.req.query("to") || today();
  return { from, to };
}

export function registerCockpit(deps: Deps) {
  const { app, pool } = deps;

  /* ================= Reglages ================= */
  app.get("/api/settings", async (c) => {
    const s = await loadAppSettings(pool);
    return c.json(s);
  });

  app.put("/api/settings", async (c) => {
    const b = await c.req.json();
    const allowed: (keyof AppSettings)[] = [
      "email_mode", "test_email", "invoice_prefix", "credit_note_prefix", "quote_prefix",
      "quote_validity_days", "default_payment_terms_days", "due_rule",
      "late_penalty_rate", "recovery_fee", "reminder_levels",
    ];
    const keys = allowed.filter((k) => k in b);
    if (!keys.length) return c.json({ error: "Aucun réglage reconnu" }, 400);

    /* Passage en mode Reel : exige une adresse de test connue ET une double
       confirmation explicite. C'est le seul endroit ou un e-mail peut
       partir vers un vrai client. */
    if (keys.includes("email_mode") && b.email_mode === "live") {
      if (b.confirm_live !== "JE-CONFIRME-ENVOIS-REELS") {
        return c.json({ error: "Confirmation requise : reconfirmez l'activation des envois réels." }, 400);
      }
      const cur = await loadAppSettings(pool);
      if (!String(cur.test_email || "").includes("@")) {
        return c.json({ error: "Renseignez d'abord une adresse e-mail de test." }, 400);
      }
    }

    const sets = keys.map((k) => `${k} = $${keys.indexOf(k) + 1}`);
    const values = keys.map((k) => (k === "email_mode" && b[k] === "live" ? "live" : b[k]));
    const extra =
      b.email_mode === "live" ? ", live_enabled_at = now()" : b.email_mode === "test" ? ", live_enabled_at = NULL" : "";
    await pool.query(
      `UPDATE app_settings SET ${sets.join(", ")}${extra}, updated_at = now() WHERE id = 1`,
      values,
    );
    return c.json(await loadAppSettings(pool));
  });

  /* ================= Depenses fournisseurs ================= */
  app.get("/api/expenses", async (c) => {
    const { from, to } = dateRange(c);
    /* Hono renvoie undefined si le parametre n'est pas present dans l'URL. */
    const q = String(c.req.query("q") || "").trim();
    const cat = String(c.req.query("category") || "").trim();
    const params: unknown[] = [from, to];
    const where = ["e.expense_date BETWEEN $1 AND $2::date"];
    if (cat) {
      params.push(cat);
      where.push(`e.category = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(`(e.supplier ILIKE $${params.length} OR e.label ILIKE $${params.length} OR e.reference ILIKE $${params.length})`);
    }
    const { rows } = await pool.query(
      `SELECT e.*, b.name AS account_name
         FROM expenses e
         LEFT JOIN bank_accounts b ON b.id = e.account_id
        WHERE ${where.join(" AND ")}
        ORDER BY e.expense_date DESC, e.id DESC
        LIMIT 500`,
      params,
    );
    const totals = await pool.query(
      `SELECT count(*)::int AS count, coalesce(sum(amount_ttc),0) AS ttc,
              coalesce(sum(amount_ht),0) AS ht, coalesce(sum(tva_rate * amount_ht / 100),0) AS tva
         FROM expenses WHERE expense_date BETWEEN $1 AND $2::date`,
      [from, to],
    );
    return c.json({ items: rows, total: totals.rows[0], range: { from, to } });
  });

  const EXPENSE_FIELDS = [
    "expense_date", "supplier", "category", "label", "reference", "amount_ht",
    "tva_rate", "amount_ttc", "account_id", "payment_method", "deductible_tva", "notes",
  ];

  app.post("/api/expenses", async (c) => {
    const b = await c.req.json();
    if (!String(b.supplier || "").trim()) return c.json({ error: "Fournisseur obligatoire" }, 400);
    const ht = num(b.amount_ht);
    const rate = num(b.tva_rate);
    const ttc = b.amount_ttc != null ? num(b.amount_ttc) : Math.round(ht * (1 + rate / 100) * 100) / 100;
    const { rows } = await pool.query(
      `INSERT INTO expenses (expense_date, supplier, category, label, reference, amount_ht, tva_rate,
                             amount_ttc, account_id, payment_method, deductible_tva, notes)
       VALUES (coalesce($1::date, CURRENT_DATE), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        b.expense_date || null, String(b.supplier).trim(), b.category || "fournisseur", b.label || "",
        b.reference || "", ht, rate, ttc, b.account_id ? Number(b.account_id) : null,
        b.payment_method || "virement", !!b.deductible_tva, b.notes || "",
      ],
    );
    await syncExpenseTransaction(pool, rows[0]);
    return c.json(rows[0], 201);
  });

  app.put("/api/expenses/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json();
    const keys = EXPENSE_FIELDS.filter((k) => k in b);
    if (!keys.length) return c.json({ error: "Aucun champ reconnu" }, 400);
    const ht = "amount_ht" in b ? num(b.amount_ht) : null;
    const rate = "tva_rate" in b ? num(b.tva_rate) : null;
    let ttc: number | null = null;
    if ("amount_ttc" in b) ttc = num(b.amount_ttc);
    else if (ht != null || rate != null) {
      const cur = await pool.query("SELECT amount_ht, tva_rate FROM expenses WHERE id = $1", [id]);
      if (!cur.rows.length) return c.json({ error: "Dépense introuvable" }, 404);
      ttc = Math.round(
        (ht ?? Number(cur.rows[0].amount_ht)) * (1 + (rate ?? Number(cur.rows[0].tva_rate)) / 100) * 100,
      ) / 100;
    }
    /* Si le TTC a ete recalcule, il doit figurer dans le SET : sans cela
       Postgres n'ecrirait que les champs explicitement envoyes. */
    if (ttc != null && !keys.includes("amount_ttc")) keys.push("amount_ttc");
    const values = keys.map((k) => {
      if (k === "amount_ttc") return ttc;
      const v = (b as any)[k];
      return k === "account_id" ? (v ? Number(v) : null) : v;
    });
    const sets = keys.map((k, i) => `${k} = $${i + 1}`);
    const { rows } = await pool.query(
      `UPDATE expenses SET ${sets.join(", ")} WHERE id = $${keys.length + 1} RETURNING *`,
      [...values, id],
    );
    if (!rows.length) return c.json({ error: "Dépense introuvable" }, 404);
    await syncExpenseTransaction(pool, rows[0]);
    return c.json(rows[0]);
  });

  /* La suppression d'une depense supprime aussi le mouvement bancaire qu'elle a
     genere : les deux ecrans restent synchronises. */
  app.delete("/api/expenses/:id", async (c) => {
    const id = Number(c.req.param("id"));
    await removeExpenseTransaction(pool, id);
    const { rows } = await pool.query("DELETE FROM expenses WHERE id = $1 RETURNING id", [id]);
    if (!rows.length) return c.json({ error: "Dépense introuvable" }, 404);
    return c.json({ ok: true, id });
  });

  /* ================= Comptes bancaires ================= */
  app.get("/api/bank-accounts", async (c) => {
    const { rows } = await pool.query(
      `SELECT b.*,
              coalesce((SELECT sum(CASE WHEN t.direction = 'out' THEN -t.amount ELSE t.amount END) FROM bank_transactions t
                         WHERE t.account_id = b.id AND t.tx_date <= CURRENT_DATE), 0) AS solde
         FROM bank_accounts b
        WHERE b.archived = false
        ORDER BY b.is_default DESC, b.sort_order, b.id`,
    );
    return c.json({ items: rows });
  });

  app.post("/api/bank-accounts", async (c) => {
    const b = await c.req.json();
    if (!String(b.name || "").trim()) return c.json({ error: "Nom du compte obligatoire" }, 400);
    const { rows } = await pool.query(
      `INSERT INTO bank_accounts (name, bank_name, iban, bic, opening_balance, opening_date, is_default, sort_order)
       VALUES ($1,$2,$3,$4,$5,coalesce($6::date, CURRENT_DATE),$7,$8) RETURNING *`,
      [
        String(b.name).trim(), b.bank_name || "", b.iban || "", b.bic || "",
        num(b.opening_balance), b.opening_date || null, !!b.is_default, num(b.sort_order),
      ],
    );
    if (b.is_default) await pool.query("UPDATE bank_accounts SET is_default = false WHERE id <> $1", [rows[0].id]);
    return c.json(rows[0], 201);
  });

  app.put("/api/bank-accounts/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json();
    const keys = ["name", "bank_name", "iban", "bic", "opening_balance", "opening_date", "is_default", "archived", "sort_order"];
    const use = keys.filter((k) => k in b);
    if (!use.length) return c.json({ error: "Aucun champ reconnu" }, 400);
    const { rows } = await pool.query(
      `UPDATE bank_accounts SET ${use.map((k, i) => `${k} = $${i + 1}`).join(", ")} WHERE id = $${use.length + 1} RETURNING *`,
      [...use.map((k) => (k === "is_default" || k === "archived" ? !!b[k] : b[k])), id],
    );
    if (!rows.length) return c.json({ error: "Compte introuvable" }, 404);
    if (b.is_default) await pool.query("UPDATE bank_accounts SET is_default = false WHERE id <> $1", [id]);
    return c.json(rows[0]);
  });

  /* Suppression definitive d'un compte. Les mouvements liees ne sont pas
     supprimes : la cle etrangere est ON DELETE SET NULL, ils sont seulement
     detaches du compte (montant et date conserves dans l'historique). */
  app.delete("/api/bank-accounts/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const { rows } = await pool.query("DELETE FROM bank_accounts WHERE id = $1 RETURNING id", [id]);
    if (!rows.length) return c.json({ error: "Compte introuvable" }, 404);
    return c.json({ ok: true, id: rows[0].id });
  });

  /* ================= Mouvements de tresorerie ================= */
  app.get("/api/transactions", async (c) => {
    const { from, to } = dateRange(c);
    const accountId = c.req.query("account_id");
    const params: unknown[] = [from, to];
    let filter = "";
    if (accountId) {
      params.push(Number(accountId));
      filter = `AND t.account_id = $${params.length}`;
    }
    const { rows } = await pool.query(
      `SELECT t.*, b.name AS account_name, cl.name AS client_name, i.number AS invoice_number,
              e.label AS expense_label, e.supplier AS expense_supplier
         FROM bank_transactions t
         LEFT JOIN bank_accounts b ON b.id = t.account_id
         LEFT JOIN clients cl ON cl.id = t.client_id
         LEFT JOIN invoices i ON i.id = t.invoice_id
         LEFT JOIN expenses e ON e.id = t.expense_id
        WHERE t.tx_date BETWEEN $1 AND $2::date ${filter}
        ORDER BY t.tx_date DESC, t.id DESC
        LIMIT 500`,
      params,
    );
    const sums = await pool.query(
      `SELECT coalesce(sum(CASE WHEN direction='in' THEN amount ELSE 0 END),0) AS entries,
              coalesce(sum(CASE WHEN direction='out' THEN amount ELSE 0 END),0) AS exits
         FROM bank_transactions WHERE tx_date BETWEEN $1 AND $2::date`,
      [from, to],
    );
    return c.json({ items: rows, total: sums.rows[0], range: { from, to } });
  });

  app.post("/api/transactions", async (c) => {
    const b = await c.req.json();
    const amount = Math.abs(num(b.amount));
    if (!amount) return c.json({ error: "Montant obligatoire" }, 400);
    const direction = b.direction === "out" ? "out" : "in";
    const { rows } = await pool.query(
      `INSERT INTO bank_transactions (account_id, tx_date, value_date, label, amount, direction, kind,
                                      client_id, invoice_id, expense_id, reference)
       VALUES ($1, coalesce($2::date, CURRENT_DATE), $3::date, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        b.account_id ? Number(b.account_id) : null, b.tx_date || null, b.value_date || null,
        b.label || "", amount, direction, b.kind || (direction === "in" ? "payment" : "other"),
        b.client_id ? Number(b.client_id) : null, b.invoice_id ? Number(b.invoice_id) : null,
        b.expense_id ? Number(b.expense_id) : null, b.reference || "",
      ],
    );
    return c.json(rows[0], 201);
  });

  app.delete("/api/transactions/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const cur = await pool.query("SELECT expense_id, payment_id FROM bank_transactions WHERE id = $1", [id]);
    if (!cur.rows.length) return c.json({ error: "Mouvement introuvable" }, 404);
    /* Les mouvements generes automatiquement ne se suppriment pas directement :
       il faut supprimer leur source (depense ou encaissement) pour rester synchrone. */
    if (cur.rows[0].expense_id || cur.rows[0].payment_id) {
      return c.json(
        { error: "Mouvement genere automatiquement (depense ou encaissement) : modifiez ou supprimez la source." },
        409,
      );
    }
    await pool.query("DELETE FROM bank_transactions WHERE id = $1", [id]);
    return c.json({ ok: true, id });
  });

  /* ================= Tresorerie : soldes ================= */
  app.get("/api/cash", async (c) => {
    const { from, to } = dateRange(c);
    const accounts = await pool.query(
      `SELECT b.id, b.name, b.iban, b.is_default,
              coalesce(b.opening_balance,0) AS opening,
              coalesce((SELECT sum(CASE WHEN t.direction = 'out' THEN -t.amount ELSE t.amount END) FROM bank_transactions t
                         WHERE t.account_id = b.id AND t.tx_date < $1::date), 0) AS before_period,
              coalesce((SELECT sum(CASE WHEN t.direction = 'out' THEN -t.amount ELSE t.amount END) FROM bank_transactions t
                         WHERE t.account_id = b.id AND t.tx_date BETWEEN $1 AND $2::date), 0) AS period_net,
              coalesce((SELECT sum(CASE WHEN t.direction = 'out' THEN -t.amount ELSE t.amount END) FROM bank_transactions t
                         WHERE t.account_id = b.id AND t.tx_date <= $2::date), 0) AS total_net
         FROM bank_accounts b
        WHERE b.archived = false
        ORDER BY b.is_default DESC, b.sort_order, b.id`,
      [from, to],
    );
    const list = accounts.rows.map((a) => ({
      ...a,
      solde:
        Number(a.opening) +
        Number(a.before_period) +
        Number(a.period_net),
    }));
    const global = list.reduce((s, a) => s + a.solde, 0);
    return c.json({
      accounts: list,
      total: global,
      range: { from, to },
      has_accounts: list.length > 0,
    });
  });

  /* ================= KPI du cockpit ================= */
  app.get("/api/kpi", async (c) => {
    const { from, to } = dateRange(c);
    const prevFrom = c.req.query("prev_from") || "";
    const prevTo = c.req.query("prev_to") || "";
    const hasPrev = !!prevFrom && !!prevTo;

    const invoicePaid = `
      coalesce((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0)`;

    const ca = await pool.query(
      `SELECT coalesce(sum(i.total_ttc),0) AS ca_ht, coalesce(sum(i.total_ht),0) AS ht,
              count(*)::int AS count
         FROM invoices i
        WHERE i.issue_date BETWEEN $1 AND $2::date AND i.status <> 'draft'`,
      [from, to],
    );
    const encaissements = await pool.query(
      `SELECT coalesce(sum(p.amount),0) AS total, count(*)::int AS count
         FROM payments p
        WHERE p.date BETWEEN $1 AND $2::date`,
      [from, to],
    );
    const aEncaisser = await pool.query(
      `SELECT count(*)::int AS count,
              coalesce(sum(i.total_ttc - ${invoicePaid}),0) AS reste
         FROM invoices i
        WHERE i.status IN ('unpaid','partial')`,
      [],
    );
    const enRetard = await pool.query(
      `SELECT count(*)::int AS count,
              coalesce(sum(i.total_ttc - ${invoicePaid}),0) AS reste,
              coalesce(max(CURRENT_DATE - i.due_date),0)::int AS pire_retard_jours
         FROM invoices i
        WHERE i.status IN ('unpaid','partial') AND i.due_date < CURRENT_DATE`,
      [],
    );
    const depenses = await pool.query(
      `SELECT coalesce(sum(amount_ttc),0) AS ttc, coalesce(sum(amount_ht),0) AS ht, count(*)::int AS count
         FROM expenses WHERE expense_date BETWEEN $1 AND $2::date`,
      [from, to],
    );
    const tresorerie = await pool.query(
      `SELECT coalesce(sum(CASE WHEN direction='in' THEN amount ELSE -amount END),0) AS net
         FROM bank_transactions WHERE tx_date BETWEEN $1 AND $2::date`,
      [from, to],
    );
    const topClients = await pool.query(
      `SELECT i.client_id AS id, coalesce(cl.name,'Client supprime') AS client,
              coalesce(sum(i.total_ttc),0) AS ca, count(*)::int AS factures
         FROM invoices i LEFT JOIN clients cl ON cl.id = i.client_id
        WHERE i.issue_date BETWEEN $1 AND $2::date AND i.client_id IS NOT NULL
        GROUP BY i.client_id, cl.name
        ORDER BY ca DESC LIMIT 8`,
      [from, to],
    );

    /* Serie mensuelle sur 12 mois pour le graphique principal. */
    const serie = await pool.query(
      `WITH months AS (
         SELECT to_char(date_trunc('month', CURRENT_DATE) - (n || ' months')::interval, 'YYYY-MM') AS ym, n
           FROM generate_series(11, 0, -1) AS n
       )
       SELECT m.ym,
              coalesce((SELECT sum(i.total_ttc) FROM invoices i
                         WHERE to_char(i.issue_date,'YYYY-MM') = m.ym), 0) AS ca,
              coalesce((SELECT sum(p.amount) FROM payments p
                         WHERE to_char(p.date,'YYYY-MM') = m.ym), 0) AS encaissements,
              coalesce((SELECT sum(e.amount_ttc) FROM expenses e
                         WHERE to_char(e.expense_date,'YYYY-MM') = m.ym), 0) AS depenses
         FROM months m ORDER BY m.ym`,
      [],
    );

    const prev = hasPrev
      ? await pool.query(
          `SELECT
             (SELECT coalesce(sum(i.total_ttc),0) FROM invoices i WHERE i.issue_date BETWEEN $1 AND $2::date) AS ca,
             (SELECT coalesce(sum(p.amount),0) FROM payments p WHERE p.date BETWEEN $1 AND $2::date) AS encaissements,
             (SELECT coalesce(sum(e.amount_ttc),0) FROM expenses e WHERE e.expense_date BETWEEN $1 AND $2::date) AS depenses`,
          [prevFrom, prevTo],
        )
      : null;

    const pct = (a: unknown, b: unknown) => {
      const x = num(a);
      const y = num(b);
      if (!y) return null;
      return Math.round(((x - y) / Math.abs(y)) * 1000) / 10;
    };

    return c.json({
      range: { from, to },
      ca_ttc: ca.rows[0].ca_ht,
      ca_ht: ca.rows[0].ht,
      factures_count: ca.rows[0].count,
      encaissements: encaissements.rows[0].total,
      encaissements_count: encaissements.rows[0].count,
      a_encaisser_count: aEncaisser.rows[0].count,
      a_encaisser_reste: aEncaisser.rows[0].reste,
      en_retard_count: enRetard.rows[0].count,
      en_retard_reste: enRetard.rows[0].reste,
      pire_retard_jours: enRetard.rows[0].pire_retard_jours,
      depenses_ttc: depenses.rows[0].ttc,
      depenses_ht: depenses.rows[0].ht,
      depenses_count: depenses.rows[0].count,
      tresorerie_nette: tresorerie.rows[0].net,
      top_clients: topClients.rows,
      serie: serie.rows,
      evolution: prev
        ? {
            ca: pct(ca.rows[0].ca_ht, prev.rows[0].ca),
            encaissements: pct(encaissements.rows[0].total, prev.rows[0].encaissements),
            depenses: pct(depenses.rows[0].ttc, prev.rows[0].depenses),
          }
        : null,
    });
  });

  /* ================= Relances ================= */
  app.get("/api/reminder-templates", async (c) => {
    const { rows } = await pool.query("SELECT * FROM reminder_templates ORDER BY level");
    if (!rows.length) await seedReminderTemplates(pool);
    return c.json({ items: (await pool.query("SELECT * FROM reminder_templates ORDER BY level")).rows });
  });

  app.put("/api/reminder-templates/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await c.req.json();
    const keys = ["label", "subject", "body", "delay_days", "tone", "active"].filter((k) => k in b);
    if (!keys.length) return c.json({ error: "Aucun champ reconnu" }, 400);
    const { rows } = await pool.query(
      `UPDATE reminder_templates SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(", ")} WHERE id = $${keys.length + 1} RETURNING *`,
      [...keys.map((k) => b[k]), id],
    );
    if (!rows.length) return c.json({ error: "Modèle introuvable" }, 404);
    return c.json(rows[0]);
  });

  /* Factures impayees a relancer : echues (retard) ET non echues (relance
     anticipee possible). Cible du centre de relances. */
  app.get("/api/reminders/due", async (c) => {
    const templates = await loadTemplates(pool);
    const { rows } = await pool.query(
      `SELECT i.id, i.number, i.status, i.issue_date, i.due_date, i.total_ttc,
              coalesce((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid,
              (CURRENT_DATE - i.due_date)::int AS retard_jours,
              (i.due_date < CURRENT_DATE) AS en_retard,
              coalesce(i.remainder_sent_count, 0) AS relances_envoyees,
              i.reminder_paused, cl.no_reminders,
              i.client_id, coalesce(cl.name,'Client supprime') AS client, cl.email,
              (SELECT max(r.level) FROM reminders r WHERE r.invoice_id = i.id AND r.status = 'sent') AS niveau_atteint
         FROM invoices i
         LEFT JOIN clients cl ON cl.id = i.client_id
        WHERE i.status IN ('unpaid','partial')
        ORDER BY (i.due_date < CURRENT_DATE) DESC, i.due_date ASC`,
    );
    const items = rows
      .map((r) => {
        const reste = Number(r.total_ttc) - Number(r.paid);
        const niveauAtteint = Number(r.niveau_atteint || 0);
        const atteint = templates.filter((t) => Number(r.retard_jours) >= t.delay_days);
        /* Palier du retard, sinon premier palier non encore envoye : permet de
           relancer une facture non echue (relance anticipee, niveau 1). */
        const suivant = atteint.find((t) => t.level > niveauAtteint)
          || templates.find((t) => t.level > niveauAtteint)
          || null;
        const relancePausee = !!r.reminder_paused;
        const clientSansRelance = !!r.no_reminders;
        return {
          ...r,
          reste,
          en_retard: !!r.en_retard,
          relance_pausee: relancePausee,
          client_sans_relance: clientSansRelance,
          niveau_suivant: suivant ? suivant.level : null,
          libelle_suivant: suivant ? suivant.label : null,
          /* Suspendue (facture) ou excludu du client : plus rien envoyer. */
          actionnable: !!suivant && reste > 0 && !relancePausee && !clientSansRelance,
        };
      })
      .filter((r) => r.reste > 0);
    return c.json({ items, templates, mode: (await loadAppSettings(pool)).email_mode });
  });

  /* Apercu : genere le contenu sans rien envoyer. */
  app.post("/api/reminders/preview", async (c) => {
    const b = await c.req.json();
    const invoiceId = Number(b.invoice_id);
    const level = num(b.level, 1);
    const templates = await loadTemplates(pool);
    const tpl = templates.find((t) => t.level === level);
    if (!tpl) return c.json({ error: "Modèle de relance introuvable" }, 404);
    const { rows } = await pool.query(
      `SELECT i.*, cl.name AS client, cl.email,
              coalesce((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id = i.id),0) AS paid
         FROM invoices i LEFT JOIN clients cl ON cl.id = i.client_id WHERE i.id = $1`,
      [invoiceId],
    );
    if (!rows.length) return c.json({ error: "Facture introuvable" }, 404);
    const company = await deps.loadCompany();
    const settings = await loadAppSettings(pool);
    const rendered = renderReminder(tpl, rows[0], company, settings);
    const target = resolveRecipient(settings, String(b.to || rows[0].email || ""));
    return c.json({
      level,
      label: tpl.label,
      subject: rendered.subject,
      body: rendered.body,
      to_client: rows[0].email || "",
      to_final: target.to,
      redirected: target.redirected,
      mode: target.mode,
    });
  });

  /* Envoi d'une relance pour une facture : logique partagee entre l'envoi
     unitaire et l'envoi par selection. Ne leve pas : renvoie un resultat que
     l'appelant agrege (utile pour un envoi groupe ou l'echec d'une facture ne
     doit pas interrompre les suivantes). */
  async function deliverReminder(invoiceId: number, level: number, channel?: string) {
    if (!Number.isFinite(invoiceId) || invoiceId <= 0) return { ok: false as const, status: 400, invoice_id: invoiceId, error: "Facture invalide" };
    const settings = await loadAppSettings(pool);
    const templates = await loadTemplates(pool);
    const tpl = templates.find((t) => t.level === level);
    if (!tpl) return { ok: false as const, status: 404, invoice_id: invoiceId, error: "Modèle de relance introuvable" };

    const { rows } = await pool.query(
      `SELECT i.*, cl.name AS client, cl.email, cl.no_reminders,
              coalesce((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id = i.id),0) AS paid
         FROM invoices i LEFT JOIN clients cl ON cl.id = i.client_id WHERE i.id = $1`,
      [invoiceId],
    );
    if (!rows.length) return { ok: false as const, status: 404, invoice_id: invoiceId, error: "Facture introuvable" };
    const invoice = rows[0];
    if (invoice.reminder_paused) return { ok: false as const, status: 400, invoice_id: invoiceId, error: "Relance suspendue pour cette facture : reprenez-la depuis le centre de relances." };
    if (invoice.no_reminders) return { ok: false as const, status: 400, invoice_id: invoiceId, error: "Les relances sont désactivées pour ce client." };
    if (!invoice.email) return { ok: false as const, status: 400, invoice_id: invoiceId, error: "Cette facture n'a pas d'adresse e-mail client." };

    const company = await deps.loadCompany();
    const rendered = renderReminder(tpl, invoice, company, settings);
    const target = resolveRecipient(settings, invoice.email);
    if (!target.to) {
      return { ok: false as const, status: 400, invoice_id: invoiceId, error: "Mode test actif mais aucune adresse de test renseignée : rien n'a été envoyé." };
    }
    const reste = Number(invoice.total_ttc) - Number(invoice.paid);

    const rec = await pool.query(
      `INSERT INTO reminders (invoice_id, template_id, level, channel, to_email, subject, body, status,
                              redirected_to_test)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'queued',$8) RETURNING *`,
      [invoiceId, tpl.id, level, channel === "courrier" ? "courrier" : "email",
       target.to, rendered.subject, rendered.body, target.redirected],
    );

    try {
      await deps.sendMail({
        to: target.to,
        subject: target.redirected ? `[TEST] ${rendered.subject}` : rendered.subject,
        text: rendered.body,
      });
      await pool.query(
        `UPDATE reminders SET status='sent', sent_at=now() WHERE id=$1`,
        [rec.rows[0].id],
      );
      /* On ne compte une relance que si elle est partie chez le vrai client. */
      if (!target.redirected) {
        await pool.query("UPDATE invoices SET remainder_sent_count = coalesce(remainder_sent_count,0) + 1 WHERE id = $1", [invoiceId]);
      }
      return {
        ok: true as const, status: 200, invoice_id: invoiceId, number: invoice.number,
        id: rec.rows[0].id, redirected: target.redirected, mode: target.mode, to: target.to, reste,
      };
    } catch (e) {
      await pool.query("UPDATE reminders SET status='failed', error = $2 WHERE id = $1", [
        rec.rows[0].id,
        String((e as Error).message).slice(0, 300),
      ]);
      return { ok: false as const, status: 502, invoice_id: invoiceId, error: "Envoi impossible", detail: (e as Error).message };
    }
  }

  app.post("/api/reminders/send", async (c) => {
    const b = await c.req.json();
    const r = await deliverReminder(Number(b.invoice_id), num(b.level, 1), b.channel);
    if (!r.ok) return c.json({ error: r.error, detail: (r as { detail?: string }).detail, invoice_id: (r as { invoice_id?: number }).invoice_id }, r.status as any);
    return c.json(r);
  });

  /* Suspendre/reprendre les relances d'une facture. */
  app.post("/api/reminders/invoice-pause", async (c) => {
    const b = await c.req.json();
    const invoiceId = Number(b.invoice_id);
    const paused = !!b.paused;
    if (!Number.isFinite(invoiceId) || invoiceId <= 0) return c.json({ error: "Facture invalide" }, 400);
    const { rowCount } = await pool.query("UPDATE invoices SET reminder_paused = $1, updated_at = now() WHERE id = $2", [
      paused,
      invoiceId,
    ]);
    if (!rowCount) return c.json({ error: "Facture introuvable" }, 404);
    return c.json({ ok: true, invoice_id: invoiceId, paused });
  });

  /* Desactiver/reactiver les relances pour tout un client. */
  app.post("/api/reminders/client-pause", async (c) => {
    const b = await c.req.json();
    const clientId = Number(b.client_id);
    const paused = !!b.paused;
    if (!Number.isFinite(clientId) || clientId <= 0) return c.json({ error: "Client invalide" }, 400);
    const { rowCount } = await pool.query("UPDATE clients SET no_reminders = $1 WHERE id = $2", [paused, clientId]);
    if (!rowCount) return c.json({ error: "Client introuvable" }, 404);
    return c.json({ ok: true, client_id: clientId, paused });
  });

  /* Envoi groupe : relance d'une selection de factures en une fois. Le niveau
     est recalcule cote serveur (meme regle que le centre de relances) : le
     client n'impose pas le palier, il choisit seulement les factures. */
  app.post("/api/reminders/send-batch", async (c) => {
    const b = await c.req.json();
    const ids: number[] = Array.isArray(b.invoice_ids)
      ? b.invoice_ids.map(Number).filter((n: number) => Number.isFinite(n) && n > 0)
      : [];
    if (!ids.length) return c.json({ error: "Aucune facture sélectionnée." }, 400);
    const templates = await loadTemplates(pool);
    const { rows } = await pool.query(
      `SELECT i.id, (CURRENT_DATE - i.due_date)::int AS retard_jours,
              (SELECT max(r.level) FROM reminders r WHERE r.invoice_id = i.id AND r.status = 'sent') AS niveau_atteint
         FROM invoices i WHERE i.id = ANY($1::int[])`,
      [ids],
    );
    const plan = new Map<number, number>();
    for (const r of rows) {
      const niveauAtteint = Number(r.niveau_atteint || 0);
      const suivant = templates.filter((t) => Number(r.retard_jours) >= t.delay_days).find((t) => t.level > niveauAtteint)
        || templates.find((t) => t.level > niveauAtteint);
      if (suivant) plan.set(Number(r.id), suivant.level);
    }
    const results: Awaited<ReturnType<typeof deliverReminder>>[] = [];
    for (const id of ids) {
      const level = plan.get(id);
      if (!level) {
        results.push({ ok: false as const, status: 400, invoice_id: id, error: "Aucun palier de relance à envoyer." });
        continue;
      }
      results.push(await deliverReminder(id, level, b.channel));
    }
    const sent = results.filter((r) => r.ok).length;
    return c.json({ ok: results.every((r) => r.ok), sent, failed: results.length - sent, results });
  });

  app.get("/api/reminders", async (c) => {
    const invoiceId = Number(c.req.query("invoice_id") || 0);
    const { rows } = await pool.query(
      `SELECT r.*, i.number AS invoice_number, cl.name AS client
         FROM reminders r
         JOIN invoices i ON i.id = r.invoice_id
         LEFT JOIN clients cl ON cl.id = i.client_id
        WHERE ($1 = 0 OR r.invoice_id = $1)
        ORDER BY r.created_at DESC LIMIT 100`,
      [invoiceId],
    );
    return c.json({ items: rows });
  });

  /* ================= Factures : verrou de finalisation ================= */

  /** Facture + lignes + client, dans la forme attendue par le generateur Factur-X. */
  async function loadInvoiceForFacturx(id: number) {
    const { rows } = await pool.query(
      `SELECT i.*, coalesce((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id = i.id),0) AS paid,
              cl.name AS client_name, cl.email AS client_email, cl.address AS client_address,
              cl.siret AS client_siret, cl.vat_number AS client_vat,
              q.number AS quote_number
         FROM invoices i LEFT JOIN clients cl ON cl.id = i.client_id
         LEFT JOIN quotes q ON q.id = i.quote_id
        WHERE i.id = $1`,
      [id],
    );
    if (!rows.length) return null;
    const inv = rows[0];
    const items = (
      await pool.query(
        `SELECT position, description, quantity, unit_price, tva_rate
           FROM invoice_items WHERE invoice_id = $1 ORDER BY position, id`,
        [id],
      )
    ).rows;
    return { inv, items };
  }

  app.get("/api/invoices/:id/facturx.xml", async (c) => {
    const id = Number(c.req.param("id"));
    const loaded = await loadInvoiceForFacturx(id);
    if (!loaded) return c.json({ error: "Facture introuvable" }, 404);
    if (!loaded.items.length) {
      return c.json({ error: "Facture sans ligne : le XML Factur-X ne peut pas etre genere." }, 422);
    }
    const company = await deps.loadCompany();
    const { inv, items } = loaded;
    const paid = num(inv.paid);
    const fx: FxInvoice = {
      number: inv.number,
      issue_date: inv.issue_date,
      due_date: inv.due_date,
      delivery_date: inv.issue_date,
      purchase_order: inv.quote_number || null,
      payment_terms: inv.conditions || null,
      legal_note: inv.conditions || null,
      total_ht: inv.total_ht,
      total_tva: inv.total_tva,
      total_ttc: inv.total_ttc,
      paid,
      remaining: Math.max(0, num(inv.total_ttc) - paid),
      items,
      client: {
        name: inv.client_name,
        email: inv.client_email,
        address: inv.client_address || null,
        siret: inv.client_siret,
        vat_number: inv.client_vat,
      },
    };
    const xml = buildFacturxXml(fx, company);
    return new Response(xml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="facturx-${inv.number}.xml"`,
        "Cache-Control": "no-store",
      },
    });
  });

  app.get("/api/invoices/:id/compliance", async (c) => {
    const id = Number(c.req.param("id"));
    const company = await deps.loadCompany();
    const loaded = await loadInvoiceForFacturx(id);
    if (!loaded) return c.json({ error: "Facture introuvable" }, 404);
    const { inv, items } = loaded;
    const checks = [
      { key: "siret", label: "SIRET de l'entreprise", ok: !!String(company.siret || "").trim() },
      { key: "vat", label: "Numéro de TVA intracommunautaire", ok: !!String(company.vat_number || "").trim() },
      { key: "address", label: "Adresse d'llegal de l'entreprise", ok: !!String(company.address || "").trim() },
      { key: "legal_name", label: "Raison sociale", ok: !!String(company.legal_name || company.name || "").trim() },
      { key: "iban", label: "IBAN de reglement", ok: !!String(company.iban || "").trim() },
      { key: "late_penalty", label: "Penalites de retard (10 % de penalisation)", ok: Number(company.late_penalty_rate ?? 0) > 0 },
      { key: "recovery_fee", label: "Indemnite forfaitaire de 40 EUR", ok: Number(company.recovery_fee ?? 0) > 0 },
      { key: "lines", label: "Au moins une ligne de prestation", ok: items.length > 0 },
      { key: "client", label: "Client renseigne sur la facture", ok: !!String(inv.client_name || "").trim() },
      { key: "totals", label: "Totaux HT / TVA / TTC coherents", ok: coherence(inv, items) },
    ];
    return c.json({
      invoice: inv,
      checks,
      ready: checks.every((k) => k.ok),
      facturx: {
        profile: "BASIC WL (urn:factur-x.eu:1p0:basicwl)",
        xml_url: `/api/invoices/${id}/facturx.xml`,
        lines: items.length,
        /* Tant que ce drapeau est faux, l'application n'annonce pas PDF/A-3 :
           la conformite doit etre confirmee par un validateur externe. */
        pdfa3_validated: false,
        note: "XML Factur-X generable et rattache au PDF ; conformite PDF/A-3 a valider avec un outil externe (verifactu / veraPDF).",
      },
    });
  });

  app.post("/api/invoices/:id/finalize", async (c) => {
    const id = Number(c.req.param("id"));
    const company = await deps.loadCompany();
    const manquants = [
      !String(company.siret || "").trim() && "SIRET",
      !String(company.vat_number || "").trim() && "numéro de TVA",
      !String(company.iban || "").trim() && "IBAN",
    ].filter(Boolean);
    if (manquants.length) {
      return c.json({ error: `Finalisation impossible : ${manquants.join(", ")} manquant(s) dans les réglages.` }, 400);
    }
    const { rows } = await pool.query(
      `UPDATE invoices SET finalized = true, finalized_at = now()
        WHERE id = $1 AND coalesce(finalized, false) = false RETURNING *`,
      [id],
    );
    if (!rows.length) {
      const already = await pool.query("SELECT finalized FROM invoices WHERE id = $1", [id]);
      if (!already.rows.length) return c.json({ error: "Facture introuvable" }, 404);
      return c.json({ error: "Cette facture est déjà finalisée et immuable. Utilisez un avoir pour la corriger." }, 409);
    }
    return c.json(rows[0]);
  });
}

/**
 * Coherence des totaux d'une facture : recalcul des lignes et de la TVA.
 * Un ecart signale un total Round-trip (devis -> facture) a corriger.
 */
function coherence(inv: Record<string, any>, items: Record<string, any>[] = []): boolean {
  const rows = items.length
    ? items
    : [];
  const ht = rows.reduce((s, it) => s + (num(it.quantity) * num(it.unit_price)), 0);
  const tva = rows.reduce((s, it) => s + num(it.quantity) * num(it.unit_price) * num(it.tva_rate) / 100, 0);
  if (!rows.length) return num(inv.total_ht) > 0 && num(inv.total_tva) >= 0 && num(inv.total_ttc) > 0;
  const r2 = (v: unknown) => Math.round(num(v) * 100) / 100;
  return (
    r2(ht) === r2(inv.total_ht) &&
    r2(tva) === r2(inv.total_tva) &&
    r2(ht + tva) === r2(inv.total_ttc)
  );
}

async function loadTemplates(pool: pg.Pool): Promise<(ReminderTemplate & { id?: number })[]> {
  const { rows } = await pool.query("SELECT * FROM reminder_templates ORDER BY level");
  if (!rows.length) {
    await seedReminderTemplates(pool);
    return (await pool.query("SELECT * FROM reminder_templates ORDER BY level")).rows;
  }
  return rows;
}

/** Modeles par defaut : J+7 rappel, J+15 relance, J+30 mise en demeure. */
async function seedReminderTemplates(pool: pg.Pool) {
  for (const t of DEFAULT_REMINDER_TEMPLATES) {
    await pool.query(
      `INSERT INTO reminder_templates (level, label, subject, body, delay_days, tone, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,true)
       ON CONFLICT (level) DO NOTHING`,
      [t.level, t.label, t.subject, t.body, t.delay_days, t.tone],
    );
  }
}

function renderReminder(
  tpl: { subject: string; body: string },
  invoice: Record<string, any>,
  company: Record<string, any>,
  settings: AppSettings,
) {
  const reste = Number(invoice.total_ttc) - Number(invoice.paid);
  const values: Record<string, string> = {
    "{client}": String(invoice.client || ""),
    "{numero}": String(invoice.number || ""),
    "{montant}": Number(invoice.total_ttc).toLocaleString("fr-FR", { style: "currency", currency: "EUR" }),
    "{reste}": reste.toLocaleString("fr-FR", { style: "currency", currency: "EUR" }),
    "{echeance}": invoice.due_date ? new Date(invoice.due_date).toLocaleDateString("fr-FR") : "",
    "{entreprise}": String(company.name || "PaletteD&co"),
    "{telephone}": String(company.phone || ""),
    "{email}": String(company.email || ""),
    "{siret}": String(company.siret || ""),
    "{iban}": String(company.iban || ""),
    "{penalites}": `${Number(settings.late_penalty_rate)} %`,
    "{indemnite}": `${Number(settings.recovery_fee)} €`,
  };
  let subject = tpl.subject;
  let body = tpl.body;
  for (const [k, v] of Object.entries(values)) {
    subject = subject.split(k).join(v);
    body = body.split(k).join(v);
  }
  return { subject, body };
}

export { DEFAULT_SETTINGS };