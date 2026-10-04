/**
 * Verification runtime des pages du cockpit dans un vrai DOM.
 *
 * Contrairement au rendu serveur, ici les useEffect s'executent : on verifie
 * donc le chemin complet "appel API -> affichage des donnees".
 * C'est le substitut le plus proche d'une verification visuelle quand aucun
 * navigateur n'est installe sur la machine.
 *
 *   npx tsx app/scripts/smoke-dom.tsx
 */
import { JSDOM } from "jsdom";

/* --- 1. DOM installe AVANT tout import de React --- */
const dom = new JSDOM("<!doctype html><html><body><div id=root></div></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
const w = dom.window as unknown as Window & typeof globalThis;
for (const key of [
  "window", "document", "HTMLElement", "Element", "Node", "Event",
  "MouseEvent", "KeyboardEvent", "CustomEvent", "getComputedStyle", "requestAnimationFrame",
  "cancelAnimationFrame", "matchMedia", "localStorage", "location", "SVGElement",
  "MutationObserver", "IntersectionObserver", "ResizeObserver",
] as const) {
  /* Node expose deja certaines globales en lecture seule (navigator, location) :
     on n'ecrase que ce qui est reellement assignable. */
  try {
    Object.defineProperty(globalThis, key, {
      value: (w as Record<string, unknown>)[key],
      writable: true,
      configurable: true,
    });
  } catch {
    /* globale non remplacable : la version de Node convient */
  }
}
for (const key of ["IntersectionObserver", "ResizeObserver"] as const) {
  if (!(globalThis as Record<string, unknown>)[key]) {
    (globalThis as Record<string, unknown>)[key] = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
}
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as Record<string, unknown>).__API_URL__ = "";

/* --- 2. Fixtures --- */
const fixtures: Record<string, unknown> = {
  "/api/company": {
    id: 1, name: "PaletteD&co", owner_name: "", siret: "12345678900012", vat_number: "FR00123456789",
    address: "10 rue des Bois", email: "contact@palette.fr", phone: "0600000000", website: "",
    iban: "FR7630004000031234567890143", bic: "", logo: "", default_tva_rate: "20",
    payment_terms: "", mentions: "", legal_name: "PaletteD&co SARL", siren: "123456789", rcs: "RCS 123 456 789",
    legal_form: "SARL", share_capital: 50000, ape: "3101Z", address2: "", zip_code: "69000",
    city: "Lyon", country: "France", insurance: "AXA 12345", default_terms_days: 30,
    late_penalty_rate: 10, recovery_fee: 40,
  },
  "/api/settings": {
    email_mode: "test", test_email: "moi@test.fr", live_enabled_at: null, invoice_prefix: "FACT",
    credit_note_prefix: "AVOIR", quote_prefix: "DEV", quote_validity_days: 30,
    default_payment_terms_days: 30, due_rule: "end_of_month_30", late_penalty_rate: 10,
    recovery_fee: 40, reminder_levels: "[7,15,30]",
  },
  "/api/kpi": {
    range: { from: "2025-10-01", to: "2026-09-30" }, ca_ttc: 48250.5, ca_ht: 40208.75,
    factures_count: 14, encaissements: 39990, encaissements_count: 12,
    a_encaisser_count: 4, a_encaisser_reste: 8260, en_retard_count: 2, en_retard_reste: 4150,
    pire_retard_jours: 37, depenses_ttc: 21300, depenses_ht: 17750, depenses_count: 31,
    tresorerie_nette: 18690, top_clients: [{ id: 3, client: "SCI Omega", ca: 18400, factures: 5 }],
    serie: Array.from({ length: 12 }, (_, i) => ({
      ym: `2026-${String(i + 1).padStart(2, "0")}`, ca: 2000 + i * 300,
      encaissements: 1800 + i * 250, depenses: 1500 + i * 90,
    })),
    evolution: { ca: 12.4, encaissements: -3.1, depenses: 8.2 },
  },
  "/api/expenses": {
    items: [
      { id: 1, expense_date: "2026-09-15", supplier: "Scierie du Parc", category: "fournisseur",
        label: "Chene massif", reference: "F-142", amount_ht: 1200, tva_rate: 20, amount_ttc: 1440,
        account_id: 1, account_name: "Compte courant", payment_method: "virement",
        deductible_tva: true, notes: "", created_at: "2026-09-15" },
      { id: 2, expense_date: "2026-09-02", supplier: "EDF", category: "energie", label: "Electricite",
        reference: "", amount_ht: 180.5, tva_rate: 20, amount_ttc: 216.6, account_id: null,
        account_name: null, payment_method: "prelevement", deductible_tva: true, notes: "", created_at: "2026-09-02" },
    ],
    total: { count: 2, ttc: 1656.6, ht: 1380.5, tva: 276.1 },
  },
  "/api/bank-accounts": {
    items: [{ id: 1, name: "Compte courant", bank_name: "Banque X", iban: "FR7630004000031234567890143",
      bic: "", currency: "EUR", opening_balance: 5000, opening_date: "2026-01-01",
      is_default: true, archived: false, solde: 12450 }],
  },
  "/api/cash": {
    accounts: [{ id: 1, name: "Compte courant", iban: "FR7630004000031234567890143", is_default: true,
      opening: 5000, before_period: 1000, period_net: 6450, total_net: 7450, solde: 12450 }],
    total: 12450, has_accounts: true, range: { from: "2025-10-01", to: "2026-09-30" },
  },
  "/api/transactions": {
    items: [
      { id: 1, account_id: 1, account_name: "Compte courant", tx_date: "2026-09-28", value_date: null,
        label: "Virement recu - Menuiserie Martin", amount: 2500, direction: "in", kind: "payment",
        client_id: 3, client_name: "SCI Omega", invoice_id: 5, invoice_number: "FACT-2026-005",
        expense_id: null, reference: "", reconciled: true },
      { id: 2, account_id: 1, account_name: "Compte courant", tx_date: "2026-09-15", value_date: null,
        label: "Achat bois", amount: 1440, direction: "out", kind: "expense", client_id: null,
        client_name: null, invoice_id: null, expense_id: 1, reference: "", reconciled: true },
    ],
    total: { entries: 2500, exits: 1440 },
  },
  "/api/reminders/due": {
    items: [{ id: 5, number: "FACT-2026-005", status: "unpaid", issue_date: "2026-07-20",
      due_date: "2026-08-30", total_ttc: 4150, paid: 0, reste: 4150, retard_jours: 37,
      relances_envoyees: 1, client_id: 3, client: "SCI Omega", email: "contact@omega.fr",
      niveau_atteint: 1, niveau_suivant: 2, libelle_suivant: "Relance ferme (J+15)", actionnable: true }],
    templates: [
      { id: 1, level: 1, label: "Rappel aimable (J+7)", subject: "Rappel", body: "Bonjour {client}", delay_days: 7, tone: "rappel", active: true, is_default: true },
      { id: 2, level: 2, label: "Relance ferme (J+15)", subject: "Relance", body: "Bonjour {client}", delay_days: 15, tone: "rappel", active: true, is_default: true },
      { id: 3, level: 3, label: "Mise en demeure (J+30)", subject: "Mise en demeure", body: "Madame, Monsieur", delay_days: 30, tone: "mise_en_demeure", active: true, is_default: true },
    ],
    mode: "test",
  },
  "/api/reminders": {
    items: [{ id: 1, invoice_id: 5, level: 1, channel: "email", to_email: "moi@test.fr",
      subject: "Rappel", status: "sent", sent_at: "2026-09-07", error: "",
      redirected_to_test: true, created_at: "2026-09-07", invoice_number: "FACT-2026-005", client: "SCI Omega" }],
  },
  "/api/reminder-templates": {
    items: [
      { id: 1, level: 1, label: "Rappel aimable (J+7)", subject: "Rappel", body: "Bonjour {client}", delay_days: 7, tone: "rappel", active: true, is_default: true },
      { id: 2, level: 2, label: "Relance ferme (J+15)", subject: "Relance", body: "Bonjour {client}", delay_days: 15, tone: "rappel", active: true, is_default: true },
      { id: 3, level: 3, label: "Mise en demeure (J+30)", subject: "Mise en demeure", body: "Madame, Monsieur", delay_days: 30, tone: "mise_en_demeure", active: true, is_default: true },
    ],
  },
  "/api/stats": {
    quotes: 8, clients: 5, invoices: 6, quotes_value: 21000, invoices_value: 48250, draft: 2, sent: 3,
    accepted: 1, declined: 1, invoiced: 1, unpaid: 2, paid: 3, partial: 1, invoices_total: 48250,
    received_total: 39000, pending_total: 9250, accepted_value: 8400, month_invoiced: 4200,
    month_count: 2, payments_total_total: 39990, acceptance_rate: 40, overdue: [], expiring_quotes: [],
    recent_invoices: [],
  },
  "/api/clients": [], "/api/quotes": [], "/api/invoices": [],
};

let calls = 0;
let missing = new Set<string>();
(globalThis as Record<string, unknown>).fetch = async (input: any) => {
  calls++;
  const path = String(typeof input === "string" ? input : input?.url || "").replace(/^https?:\/\/[^/]+/, "").split("?")[0];
  const body = fixtures[path];
  if (body === undefined) {
    missing.add(path);
    return { ok: false, status: 404, json: async () => ({ error: `fixture absente : ${path}` }) };
  }
  return { ok: true, status: 200, json: async () => body };
};

/* --- 3. Imports --- */
const React = (await import("react")).default;
(globalThis as Record<string, unknown>).React = React;
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { MemoryRouter } = await import("react-router-dom");

const ROOT = "/media/home/DIsk 02/PaletteD&co/APP de devis/app/src";
const { ThemeProvider } = await import(`${ROOT}/components/ThemeProvider`);
const { PeriodProvider } = await import(`${ROOT}/lib/period`);
const { KpiBand } = await import(`${ROOT}/components/KpiBand`);
const { CockpitSettings } = await import(`${ROOT}/components/CockpitSettings`);
const Expenses = (await import(`${ROOT}/pages/Expenses`)).default;
const Cash = (await import(`${ROOT}/pages/Cash`)).default;
const Relances = (await import(`${ROOT}/pages/Relances`)).default;

/* --- 4. Utilitaires de test --- */
let pass = 0;
let fail = 0;
const failures: string[] = [];

const text = () => (w.document.body.textContent || "").replace(/\s+/g, " ");
const html = () => w.document.body.innerHTML;
const has = (needle: string) => text().includes(needle);
/** Le libelle d'une <option> est dans son textContent, pas dans la valeur du select. */
const hasOption = (needle: string) =>
  Array.from(w.document.querySelectorAll("option")).some((o: any) => (o.textContent || "").includes(needle));
/** La valeur d'un <input> vit dans la propriete .value, pas dans textContent. */
const hasInput = (needle: string) =>
  Array.from(w.document.querySelectorAll("input, select, textarea")).some(
    (el: any) => String(el.value ?? "").includes(needle),
  );

function ok(label: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  OK    ${label}`);
  } else {
    fail++;
    failures.push(`${label} ${detail}`);
    console.log(`  ECHEC ${label} ${detail}`);
  }
}

async function mount(element: React.ReactElement) {
  const host = w.document.createElement("div");
  w.document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(MemoryRouter, { initialEntries: ["/"] },
      React.createElement(ThemeProvider, null, React.createElement(PeriodProvider, null, element))));
  });
  /* Laisse les effets et les setTimeout(0) se vider. */
  await act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });
  return root;
}

console.log("\n=== Page Depenses (DOM reel, effets executes) ===");
await mount(React.createElement(Expenses));
ok("titre present", has("Depenses") || has("Dépenses"));
ok("fournisseur affiche", has("Scierie du Parc"));
ok("total TTC formate en euros", has("1 656,60"), `trouve : ${text().slice(0, 90)}`);
ok("montant HT affiche", has("1 200,00"));
ok("TVA calculee (276,10)", has("276,10"));
ok("repartition par poste", has("Energie et fluides"));
ok("aucun NaN dans la page", !has("NaN"));
ok("aucune erreur d'API visible", !has("fixture absente"));
ok("les montants bien formates (pas de 1656.6)", !has("1656.6"));

console.log("\n=== Page Tresorerie ===");
await mount(React.createElement(Cash));
ok("solde total affiche", has("12 450,00"), `trouve : ${text().slice(0, 90)}`);
ok("entrees (2 500,00)", has("2 500,00"));
ok("sorties (1 440,00)", has("1 440,00"));
ok("compte bancaire list", has("Compte courant"));
ok("mouvement entrant list", has("Virement recu"));
ok("montant entrant signe +", has("+2 500,00"));
ok("montant sortant signe -", has("−1 440,00"));
ok("aucun NaN", !has("NaN"));

console.log("\n=== Page Relances ===");
await mount(React.createElement(Relances));
ok("bandeau mode test", has("Mode test actif"));
ok("facture en retard listee", has("FACT-2026-005"));
ok("client affiche", has("SCI Omega"));
ok("reste du affiche", has("4 150,00"));
ok("retard en jours", has("37 j"));
ok("prochaine etape = relance ferme", has("Relance ferme (J+15)"));
ok("montant en souffrance", has("Montant en souffrance"));
ok("relance historisee", has("redirige test") || has("redirigé test"));
ok("aucun NaN", !has("NaN"));

console.log("\n=== Bandeau KPI ===");
await mount(React.createElement(KpiBand));
ok("CA TTC", has("48 250,50"));
ok("encaissements", has("39 990,00"));
ok("factures a encaisser", has("8 260,00"));
ok("en retard", has("4 150,00"));
ok("tresorerie nette", has("18 690,00"));
ok("depenses", has("21 300,00"));
ok("variation N-1 affichee", has("12,4") || has("12.4"), `attendu 12,4 %`);
ok("graphique 12 mois", (html().match(/2026-01|2026-12/g) || []).length >= 2);
ok("meilleurs clients", has("Meilleurs clients") && has("SCI Omega"));
ok("aucun NaN / Infinity", !has("NaN") && !has("Infinity"));

console.log("\n=== Reglages cockpit ===");
await mount(React.createElement(CockpitSettings));
ok("mode test affiche", has("Mode test") || has("mode test"));
ok("adresse de test renseignee", hasInput("moi@test.fr"));
ok("regle 30 jours fin de mois", hasOption("30 jours fin de mois") && hasInput("end_of_month_30"));
ok("penalites de retard", hasInput("10"));
ok("indemnite 40 EUR", hasInput("40"));
ok("3 modeles de relance", has("J+7") && has("J+15") && has("J+30"));
ok("mise en demeure editable", has("Mise en demeure (J+30)"));
ok("aucun NaN", !has("NaN"));

console.log("\n=== Verification des classes de theme ===");
ok("aucune couleur codee en dur dans le DOM", !/#(?:251710|14b8a6|1c130c|f5efe6)6/.test(html()));
ok("les tokens de surface sont utilises", html().includes("bg-surface") || html().includes("bg-app"));

console.log(`\n${pass} verifications reussies, ${fail} echecs`);
console.log(`(${calls} appels API simules, ${missing.size} fixture(s) manquante(s)${missing.size ? " : " + [...missing].join(", ") : ""})`);
if (fail) {
  console.log("\nDetail des echecs :");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}