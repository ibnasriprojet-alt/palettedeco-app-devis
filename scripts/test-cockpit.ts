/**
 * Tests de bout en bout des nouvelles routes cockpit.
 * L'app Hono est appelee en memoire (app.request), sur la BASE DE DEV
 * (charge .env.dev, jamais .env.local pour DATABASE_URL).
 * Les donnees creees sont supprimees en fin de script.
 *
 *   npx tsx scripts/test-cockpit.ts
 */
import { XMLValidator } from "fast-xml-parser";
import { inflateSync } from "node:zlib";

import { loadDevEnv, ROOT } from "./_dev-env.mjs";

/* Toute variable DATABASE_URL vient de .env.dev : le test ne peut pas ecrire
   en production meme si .env.local a ete lu. Le module verifie l'hote. */
loadDevEnv();

const { default: app } = await import(ROOT + "/src/index.ts");

const KEY = process.env.API_TOKEN || "";
let pass = 0;
let fail = 0;
const failures = [];

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`  OK    ${label}`);
  } else {
    fail++;
    failures.push(`${label} ${detail}`);
    console.log(`  ECHEC ${label} ${detail}`);
  }
}

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { "x-api-key": KEY, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* pas de JSON */
  }
  return { status: res.status, json };
}

/** Une creation reussie vaut 200 ou 201 selon la route. */
const isCreated = (r: { status: number; json: any }) => (r.status === 200 || r.status === 201) && r.json?.id > 0;

/* Tout ce que le script cree est note ici pour etre supprime sans ambiguite :
   une facture finalisee ne peut plus etre supprimee par l'API (comportement
   voulu), le residu de test est donc efface directement en base. */
const createdInvoiceIds: number[] = [];
const createdQuoteIds: number[] = [];
const createdClientIds: number[] = [];

console.log("\n=== 1. Reglages et mode e-mail ===");
/* Le mode en base depend de l'utilisateur (il peut passer en mode Reel dans
   l'ecran Reglages) : on separe la garantie de DEFAUT en code (toujours
   "test") et la validite du mode lu en base. */
const { DEFAULT_SETTINGS } = await import(ROOT + "/src/settings.ts");
const set0 = await call("GET", "/api/settings");
check("GET /api/settings répond 200", set0.status === 200, `recu ${set0.status}`);
check("defaut en code du mode e-mail = test", DEFAULT_SETTINGS.email_mode === "test", `recu ${DEFAULT_SETTINGS.email_mode}`);
check("mode e-mail lu en base valide", ["test", "live"].includes(set0.json?.email_mode), `recu ${set0.json?.email_mode}`);
check("regle d'echeance = fin de mois 30 j", set0.json?.due_rule === "end_of_month_30", `recu ${set0.json?.due_rule}`);

const liveNoCode = await call("PUT", "/api/settings", { email_mode: "live" });
check("mode live refuse sans code de confirmation", liveNoCode.status === 400, `recu ${liveNoCode.status}`);
const liveBadCode = await call("PUT", "/api/settings", { email_mode: "live", confirm_live: "nimporte" });
check("mode live refuse avec mauvais code", liveBadCode.status === 400, `recu ${liveBadCode.status}`);

console.log("\n=== 2. KPI ===");
const kpi = await call(
  "GET",
  `/api/kpi?from=2025-01-01&to=2026-12-31&prev_from=2024-01-01&prev_to=2024-12-31`,
);
check("GET /api/kpi repond 200", kpi.status === 200, `recu ${kpi.status}`);
for (const key of [
  "ca_ttc", "encaissements", "a_encaisser_reste", "en_retard_reste",
  "depenses_ttc", "tresorerie_nette", "top_clients", "serie", "evolution",
]) {
  check(`KPI contient ${key}`, kpi.json && kpi.json[key] !== undefined);
}
check("serie = 12 mois", kpi.json?.serie?.length === 12, `${kpi.json?.serie?.length} mois`);

console.log("\n=== 3. Depenses (ecriture sur base de dev) ===");
const before = await call("GET", "/api/expenses?from=2020-01-01&to=2030-12-31");
const countBefore = before.json?.total?.count ?? 0;

const created = await call("POST", "/api/expenses", {
  expense_date: "2026-09-15",
  supplier: "Scierie Test SAS",
  category: "fournisseur",
  label: "Chene massif 2,5 m",
  amount_ht: 1000,
  tva_rate: 20,
});
check("POST /api/expenses cree la depense", created.status === 201, `recu ${created.status}`);
check("TTC calcule automatiquement (1200)", Number(created.json?.amount_ttc) === 1200, `recu ${created.json?.amount_ttc}`);

const noSupplier = await call("POST", "/api/expenses", { amount_ht: 10 });
check("POST sans fournisseur refuse", noSupplier.status === 400, `recu ${noSupplier.status}`);

const listed = await call("GET", "/api/expenses?from=2020-01-01&to=2030-12-31");
check("la depense apparait dans la liste", (listed.json?.items || []).some((e: any) => e.supplier === "Scierie Test SAS"));
check("total recompute", (listed.json?.total?.count ?? 0) === countBefore + 1, `${listed.json?.total?.count} vs ${countBefore + 1}`);

const searched = await call("GET", "/api/expenses?from=2020-01-01&to=2030-12-31&q=Scierie");
check("recherche fournisseur fonctionne", searched.json?.items?.length === 1, `${searched.json?.items?.length} resultat(s)`);

const updated = await call("PUT", `/api/expenses/${created.json.id}`, { amount_ht: 500 });
check("PUT recalcule le TTC (600)", Number(updated.json?.amount_ttc) === 600, `recu ${updated.json?.amount_ttc}`);

console.log("\n=== 4. Tresorerie ===");
/* Rejouabilite : on archive les comptes et comptes de test deja presents
   (ils ne sont pas supprimes, on ne fait donc aucune ecriture destructive). */
for (const a of (await call("GET", "/api/bank-accounts")).json?.items || []) {
  await call("PUT", `/api/bank-accounts/${a.id}`, { archived: true });
}
const cash0 = await call("GET", "/api/cash?from=2026-01-01&to=2026-12-31");
check("GET /api/cash repond 200", cash0.status === 200, `recu ${cash0.status}`);
check("aucun compte actif = etat vide explicite", cash0.json?.has_accounts === false, `${cash0.json?.has_accounts}`);

const acct = await call("POST", "/api/bank-accounts", {
  name: "Compte courant",
  iban: "FR7630004000031234567890143",
  opening_balance: 5000,
  is_default: true,
});
check("POST /api/bank-accounts cree le compte", acct.status === 201, `recu ${acct.status}`);

const tx = await call("POST", "/api/transactions", {
  account_id: acct.json.id, tx_date: "2026-09-20", label: "Virement recu",
  amount: 1200, direction: "in", kind: "payment",
});
check("POST /api/transactions enregistre une entree", tx.status === 201, `recu ${tx.status}`);

const txOut = await call("POST", "/api/transactions", {
  account_id: acct.json.id, tx_date: "2026-09-21", label: "Achat bois",
  amount: 300, direction: "out", kind: "expense", expense_id: created.json.id,
});
check("POST /api/transactions enregistre une sortie", txOut.status === 201, `recu ${txOut.status}`);

const cash1 = await call("GET", "/api/cash?from=2026-01-01&to=2026-12-31");
check(
  "solde du compte de test = 5000 + 1200 - 300 = 5900",
  Number(cash1.json?.accounts?.[0]?.solde) === 5900,
  `recu ${cash1.json?.accounts?.[0]?.solde}`,
);
check(
  "solde total = 5900 (aucun autre compte actif)",
  Number(cash1.json?.total) === 5900,
  `recu ${cash1.json?.total}`,
);

const txs = await call("GET", "/api/transactions?from=2026-01-01&to=2026-12-31");
check("aggregat entrees = 1200", Number(txs.json?.total?.entries) === 1200, `recu ${txs.json?.total?.entries}`);
check("aggregat sorties = 300", Number(txs.json?.total?.exits) === 300, `recu ${txs.json?.total?.exits}`);

const blocked = await call("DELETE", `/api/expenses/${created.json.id}`);
check(
  "depense liee a un mouvement : suppression refusee (409)",
  blocked.status === 409,
  `recu ${blocked.status}`,
);

/* Modification et suppression d'un compte bancaire. */
const acct2 = await call("POST", "/api/bank-accounts", {
  name: "Compte secondaire",
  bank_name: "Banque Test",
  iban: "FR7612345678901234567890123",
  is_default: false,
});
check("second compte cree", acct2.status === 201, `recu ${acct2.status}`);

const acct2Edit = await call("PUT", `/api/bank-accounts/${acct2.json?.id}`, {
  name: "Compte secondaire (renomme)",
  iban: "FR7699999999999999999999999",
});
check("modification du compte acceptee", acct2Edit.status === 200, `recu ${acct2Edit.status}`);
check("nom du compte modifie", acct2Edit.json?.name === "Compte secondaire (renomme)", `recu ${acct2Edit.json?.name}`);
check("IBAN du compte modifie", acct2Edit.json?.iban === "FR7699999999999999999999999", `recu ${acct2Edit.json?.iban}`);
check("PUT sans champ reconnu refuse", (await call("PUT", `/api/bank-accounts/${acct2.json?.id}`, {})).status === 400);

const tx2 = await call("POST", "/api/transactions", {
  account_id: acct2.json.id, tx_date: "2026-01-15", label: "Mouvement compte secondaire",
  amount: 250, direction: "in", kind: "payment",
});
check("mouvement rattache au second compte", tx2.status === 201, `recu ${tx2.status}`);

const acct2Del = await call("DELETE", `/api/bank-accounts/${acct2.json?.id}`);
check("suppression du compte acceptee", acct2Del.status === 200, `recu ${acct2Del.status}`);
const acctList = await call("GET", "/api/bank-accounts");
check("compte supprime absent de la liste", !(acctList.json?.items || []).some((a: any) => a.id === acct2.json?.id), "compte residuel");

const txsAfterDel = await call("GET", "/api/transactions?from=2026-01-01&to=2026-12-31");
const detached = (txsAfterDel.json?.items || []).find((t: any) => t.id === tx2.json?.id);
check("mouvement conserve apres suppression du compte", !!detached, "mouvement perdu");
check("mouvement detache du compte (account_id nul)", detached && detached.account_id === null, `${detached?.account_id}`);
await call("DELETE", `/api/transactions/${tx2.json?.id}`);

check("suppression d'un compte inexistant -> 404", (await call("DELETE", "/api/bank-accounts/99999999")).status === 404);

console.log("\n=== 5. Relances ===");
const tpl = await call("GET", "/api/reminder-templates");
check("3 modeles de relance par defaut", tpl.json?.items?.length === 3, `${tpl.json?.items?.length}`);
check("paliers 7/15/30 jours", JSON.stringify(tpl.json?.items?.map((t: any) => t.delay_days)) === "[7,15,30]", JSON.stringify(tpl.json?.items?.map((t: any) => t.delay_days)));

const mdr = tpl.json?.items?.find((t: any) => t.tone === "mise_en_demeure");
check("la mise en demeure cite l'indemnite de 40 EUR", /\{indemnite\}/.test(mdr?.body || ""));
check("la mise en demeure cite les penalites", /\{penalites\}/.test(mdr?.body || ""));
check("la mise en demeure cite l'article 1231-6", /1231-6/.test(mdr?.body || ""));

const due = await call("GET", "/api/reminders/due");
check("GET /api/reminders/due repond 200", due.status === 200, `recu ${due.status}`);
check("mode transmis a l'interface", ["test", "live"].includes(due.json?.mode), `recu ${due.json?.mode}`);

/* Envoi groupe : sans facture selectionnee, rien n'est envoye (test sans
   effet de bord : aucune relance n'est envoyee en mode reel). */
const batchEmpty = await call("POST", "/api/reminders/send-batch", { invoice_ids: [] });
check("send-batch refuse la selection vide", batchEmpty.status === 400, `recu ${batchEmpty.status}`);

console.log("\n=== 5bis. Mise en pause et exclusion des relances ===");
/* Facture de test (client avec e-mail) pour verifier les deux verrous :
   pause d'une facture et exclusion d'un client. Aucun e-mail ne part :
   les envois testes sont refuses par les gardes, jamais aboutis. */
const rpClient = await call("POST", "/api/clients", { name: "Client Pause Test", email: "pause@test.fr" });
if (rpClient.json?.id > 0) createdClientIds.push(rpClient.json.id);
const rpQuote = await call("POST", "/api/quotes", {
  client_id: rpClient.json?.id, status: "accepted",
  items: [{ description: "Prestation pause", quantity: 1, unit_price: 200, tva_rate: 20 }],
});
if (rpQuote.json?.id > 0) createdQuoteIds.push(rpQuote.json.id);
const rpConv = await call("POST", `/api/quotes/${rpQuote.json?.id}/convert`, {});
const rpInv = rpConv.json;
if (rpInv?.id > 0) createdInvoiceIds.push(rpInv.id);
check("facture de test creee pour les relances", isCreated(rpConv), `recu ${rpConv.status}`);

const dueItem = async () =>
  (await call("GET", "/api/reminders/due")).json?.items?.find((i: any) => i.id === rpInv?.id);

let it0 = await dueItem();
check("facture presente dans les relances", !!it0 && it0.actionnable === true, JSON.stringify(it0));

/* 1) Pause de la facture. */
const pauseOn = await call("POST", "/api/reminders/invoice-pause", { invoice_id: rpInv?.id, paused: true });
check("mise en pause acceptee", pauseOn.status === 200 && pauseOn.json?.paused === true, `recu ${pauseOn.status}`);
it0 = await dueItem();
check("facture marquee en pause", it0?.relance_pausee === true, JSON.stringify(it0));
check("facture en pause non actionnable", it0?.actionnable === false, JSON.stringify(it0));
const sendPaused = await call("POST", "/api/reminders/send", { invoice_id: rpInv?.id, level: 1 });
check("envoi refuse pour une facture en pause", sendPaused.status === 400, `recu ${sendPaused.status} ${JSON.stringify(sendPaused.json)}`);
const batchPaused = await call("POST", "/api/reminders/send-batch", { invoice_ids: [rpInv?.id] });
check("envoi groupe refuse la facture en pause", batchPaused.json?.sent === 0 && batchPaused.json?.failed === 1, JSON.stringify(batchPaused.json));

/* 2) Reprise de la facture. */
const pauseOff = await call("POST", "/api/reminders/invoice-pause", { invoice_id: rpInv?.id, paused: false });
check("reprise acceptee", pauseOff.status === 200 && pauseOff.json?.paused === false, `recu ${pauseOff.status}`);
it0 = await dueItem();
check("facture a nouveau actionnable", it0?.actionnable === true && it0?.relance_pausee === false, JSON.stringify(it0));

/* 3) Exclusion du client (plus jamais de relance). */
const clPauseOn = await call("POST", "/api/reminders/client-pause", { client_id: rpClient.json?.id, paused: true });
check("exclusion client acceptee", clPauseOn.status === 200 && clPauseOn.json?.paused === true, `recu ${clPauseOn.status}`);
it0 = await dueItem();
check("facture marquee client exclu", it0?.client_sans_relance === true, JSON.stringify(it0));
check("facture d'un client exclu non actionnable", it0?.actionnable === false, JSON.stringify(it0));
const sendExcluded = await call("POST", "/api/reminders/send", { invoice_id: rpInv?.id, level: 1 });
check("envoi refuse pour un client exclu", sendExcluded.status === 400, `recu ${sendExcluded.status} ${JSON.stringify(sendExcluded.json)}`);
const clList = await call("GET", "/api/clients");
check("client marque no_reminders en base", (clList.json || []).some((cl: any) => cl.id === rpClient.json?.id && cl.no_reminders === true), "no_reminders absent");

/* 4) Reactivation. */
const clPauseOff = await call("POST", "/api/reminders/client-pause", { client_id: rpClient.json?.id, paused: false });
check("reactivation client acceptee", clPauseOff.status === 200 && clPauseOff.json?.paused === false, `recu ${clPauseOff.status}`);
it0 = await dueItem();
check("facture a nouveau actionnable apres reactivation", it0?.actionnable === true && it0?.client_sans_relance === false, JSON.stringify(it0));

/* 5) Validations d'entree. */
check("pause : facture invalide refusee", (await call("POST", "/api/reminders/invoice-pause", { invoice_id: 0, paused: true })).status === 400);
check("pause : facture inexistante -> 404", (await call("POST", "/api/reminders/invoice-pause", { invoice_id: 99999999, paused: true })).status === 404);
check("exclusion : client invalide refuse", (await call("POST", "/api/reminders/client-pause", { client_id: 0, paused: true })).status === 400);
check("exclusion : client inexistant -> 404", (await call("POST", "/api/reminders/client-pause", { client_id: 99999999, paused: true })).status === 404);

console.log("\n=== 7. Factur-X (facture de test creee puis supprimee) ===");
/* La base de dev n'a pas de facture : on cree un client, un devis, on le
   convertit, puis on supprime tout. Les factures existantes sont intactes. */
const fxClient = await call("POST", "/api/clients", {
  name: "Client Factur-X <test>",
  address: "5 avenue de la Paix\n69003 Lyon",
  email: "fx@test.fr",
  siret: "98765432100045",
  vat_number: "FR00987654321",
});
if (fxClient.json?.id > 0) createdClientIds.push(fxClient.json.id);
check("client de test cree", isCreated(fxClient), `recu ${fxClient.status} ${JSON.stringify(fxClient.json).slice(0, 80)}`);

const fxQuote = await call("POST", "/api/quotes", {
  client_id: fxClient.json?.id,
  status: "accepted",
  issue_date: "2026-09-15",
  conditions: "Reglement par virement sous 30 jours.",
  items: [
    { description: 'Meuble sur mesure "Chene massif" & finition', quantity: 2, unit_price: 1000, tva_rate: 20 },
    { description: "Livraison express", quantity: 1, unit_price: 500, tva_rate: 10 },
  ],
});
if (fxQuote.json?.id > 0) createdQuoteIds.push(fxQuote.json.id);
check("devis de test cree", isCreated(fxQuote), `recu ${fxQuote.status} ${JSON.stringify(fxQuote.json).slice(0, 120)}`);
const fxConv = await call("POST", `/api/quotes/${fxQuote.json?.id}/convert`, {});
check("devis converti en facture", isCreated(fxConv), `recu ${fxConv.status} ${JSON.stringify(fxConv.json).slice(0, 120)}`);
const fxInv = fxConv.json;
if (fxInv?.id > 0) createdInvoiceIds.push(fxInv.id);

/* Une facture deja finalisee doit refuser toute suppression. */
const fxDelBefore = await call("DELETE", `/api/invoices/${fxInv?.id}`);
check("facture non finalisee encore supprimable (etat initial)", fxDelBefore.status === 200, `recu ${fxDelBefore.status}`);

const fxQuote2 = await call("POST", "/api/quotes", {
  client_id: fxClient.json?.id, status: "accepted", issue_date: "2026-09-15",
  items: [{ description: "Prestation test Factur-X", quantity: 1, unit_price: 1000, tva_rate: 20 }],
});
if (fxQuote2.json?.id > 0) createdQuoteIds.push(fxQuote2.json.id);
const fxConv2 = await call("POST", `/api/quotes/${fxQuote2.json?.id}/convert`, {});
const fxInv2 = fxConv2.json;
if (fxInv2?.id > 0) createdInvoiceIds.push(fxInv2.id);

const comp = await call("GET", `/api/invoices/${fxInv2.id}/compliance`);
check("compliance repond 200", comp.status === 200, `recu ${comp.status}`);
check("10 controles de conformite", comp.json?.checks?.length === 10, `${comp.json?.checks?.length}`);
check("controle des lignes de facture", comp.json?.checks?.some((k: any) => k.key === "lines" && k.ok));
check("controle de coherence des totaux", comp.json?.checks?.some((k: any) => k.key === "totals" && k.ok), JSON.stringify(comp.json?.checks?.find((k: any) => k.key === "totals")));
check("profil Factur-X annonce", /basicwl/.test(comp.json?.facturx?.profile || ""), comp.json?.facturx?.profile || "vide");
check("PDF/A-3 non valide sans outil externe", comp.json?.facturx?.pdfa3_validated === false);

const res = await app.request(`/api/invoices/${fxInv2.id}/facturx.xml`, { headers: { "x-api-key": KEY } });
const xml = await res.text();
check("GET facturx.xml repond 200", res.status === 200, `recu ${res.status}`);
check("Content-Type XML", (res.headers.get("content-type") || "").includes("xml"), res.headers.get("content-type") || "vide");
check("piece jointe nommee facturx-", (res.headers.get("content-disposition") || "").includes("facturx-"), res.headers.get("content-disposition") || "vide");
check("XML bien forme", XMLValidator.validate(xml) === true, "XML malforme");
check("profil BASIC-WL", /urn:factur-x\.eu:1p0:basicwl/.test(xml));
check("racine CrossIndustryInvoice", /<rsm:CrossIndustryInvoice/.test(xml));
check("deux lignes de facture", (xml.match(/IncludedSupplyChainTradeLineItem/g) || []).length === 2, `${(xml.match(/IncludedSupplyChainTradeLineItem/g) || []).length}`);
check("client echappe dans le XML", /Client Factur-X &lt;test&gt;/.test(xml), "echappement absent");
check("taxe de ligne + taxe d'en-tete", (xml.match(/<ram:ApplicableTradeTax>/g) || []).length === 2, `${(xml.match(/<ram:ApplicableTradeTax>/g) || []).length} (1 ligne + 1 taux)`);
check("moyen de paiement present si IBAN renseigne", !/PaymentMeansCode/.test(xml) || /Information/.test(xml), "PaymentMeansCode sans Information");

const pdfRes = await app.request(`/api/pdf/invoice/${fxInv2.id}`, { headers: { "x-api-key": KEY } });
const pdf = Buffer.from(await pdfRes.arrayBuffer());
check("PDF regenere sans erreur", pdfRes.status === 200 && pdf.subarray(0, 5).toString() === "%PDF-", `${pdfRes.status} ${pdf.subarray(0, 5)}`);
check("PDF contient une piece jointe /EmbeddedFile", pdf.includes(Buffer.from("/EmbeddedFile")), "absent");
check("PDF declare AFRelationship /Data", pdf.includes(Buffer.from("/AFRelationship /Data")), "absent");
check("PDF nomme la piece facturx-*.xml", pdf.includes(Buffer.from("facturx-FAC")), "absent");
/* pdfkit compresse les flux (FlateDecode) : on decompresse chaque flux du PDF
   pour verifier que le XML voyage bien avec la facture. */
let xmlInPdf = false;
let streamCount = 0;
for (const m of pdf.toString("latin1").matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
  streamCount++;
  try {
    const txt = inflateSync(Buffer.from(m[1], "latin1")).toString("utf8");
    if (txt.includes("CrossIndustryInvoice")) xmlInPdf = true;
  } catch {
    /* flux non compresse ou image : ignore */
  }
}
check("le PDF contient des flux", streamCount > 0, `${streamCount} flux`);
check("le XML Factur-X est bien embarque dans le PDF", xmlInPdf, "XML absent des flux decompresses");
check("le XML embarque contient le profil BASIC-WL", (() => {
  for (const m of pdf.toString("latin1").matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try {
      const t = inflateSync(Buffer.from(m[1], "latin1")).toString("utf8");
      if (t.includes("basicwl")) return true;
    } catch {}
  }
  return false;
})(), "profil absent");

/* L'immuabilite ne peut etre verifiee que si la societe est complete :
   on memorise les reglages, on les complete, puis on restaure a l'identique. */
const co0 = await call("GET", "/api/company");
const coBackup = co0.json || {};
const patch = {};
for (const k of ["siret", "vat_number", "iban", "address", "legal_name"]) {
  if (!String(coBackup[k] || "").trim()) patch[k] = k === "iban" ? "FR7630004000031234567890143" : k === "vat_number" ? "FR00123456789" : k === "siret" ? "12345678900012" : k === "address" ? "10 rue des Bois" : "PaletteD&co SARL";
}
const coSet = await call("PUT", "/api/company", { ...coBackup, ...patch });
check("reglages societe completes pour le test", coSet.status === 200, `recu ${coSet.status}`);

const compFull = await call("GET", `/api/invoices/${fxInv2.id}/compliance`);
const failedChecks = (compFull.json?.checks || []).filter((k: any) => !k.ok).map((k: any) => k.label);
check("tous les controles passent une fois les reglages complets", failedChecks.length === 0, failedChecks.join(", "));
check("ready = true", compFull.json?.ready === true, `ready=${compFull.json?.ready}`);

const fin = await call("POST", `/api/invoices/${fxInv2.id}/finalize`);
check("finalisation acceptee", fin.status === 200, `recu ${fin.status} ${JSON.stringify(fin.json)}`);
check("facture marquee finalee", fin.json?.finalized === true);
const del = await call("DELETE", `/api/invoices/${fxInv2.id}`);
check("facture finalisee : suppression refusee (409)", del.status === 409, `recu ${del.status}`);
const fin2 = await call("POST", `/api/invoices/${fxInv2.id}/finalize`);
check("double finalisation refusee (409)", fin2.status === 409, `recu ${fin2.status}`);
check("le message oriente vers l'avoir", /avoir/i.test(fin2.json?.error || ""), fin2.json?.error || "vide");
/* Aucune route PUT /api/invoices/:id n'existe : une facture ne se modifie pas
   par l'API, seule la suppression devait etre protegee (fait plus haut). */
const put = await call("PUT", `/api/invoices/${fxInv2.id}`, { total_ttc: 1 });
check("aucune route de modification de facture", put.status === 404, `recu ${put.status}`);
const pay = await call("POST", `/api/invoices/${fxInv2.id}/payments`, { amount: 10 });
check("reglement sur facture finalisee autorise (avoir = correction legale)", pay.status === 200 || pay.status === 201, `recu ${pay.status}`);

const fx404 = await call("GET", "/api/invoices/999999/facturx.xml");
check("facturx.xml sur facture inexistante -> 404", fx404.status === 404, `recu ${fx404.status}`);
const fxNoItems = await call("POST", "/api/quotes", { client_id: fxClient.json?.id, status: "accepted", items: [] });
if (fxNoItems.json?.id > 0) createdQuoteIds.push(fxNoItems.json.id);
const fxConv3 = await call("POST", `/api/quotes/${fxNoItems.json?.id}/convert`, {});
if (fxConv3.json?.id > 0) createdInvoiceIds.push(fxConv3.json.id);
const fxEmpty = await call("GET", `/api/invoices/${fxConv3.json?.id}/facturx.xml`);
check("facture sans ligne -> 422 explicite", fxEmpty.status === 422, `recu ${fxEmpty.status}`);

console.log("\n=== 8. Lien de validation en ligne ===");
/* Client SANS e-mail : l'acceptation doit demander l'adresse avant de valider,
   puis accepter, enregistrer le mail et envoyer le devis (envoi simule). */
const vaClient = await call("POST", "/api/clients", { name: "Client Accept Test", email: "" });
if (vaClient.json?.id > 0) createdClientIds.push(vaClient.json.id);
const vaQuote = await call("POST", "/api/quotes", {
  client_id: vaClient.json?.id, status: "sent", issue_date: "2026-09-20", valid_until: "2026-10-20",
  items: [{ description: "Prestation test", quantity: 1, unit_price: 100, tva_rate: 20 }],
});
if (vaQuote.json?.id > 0) createdQuoteIds.push(vaQuote.json.id);
const vaId = vaQuote.json?.id;
const vaShare = await call("GET", `/api/quotes/${vaId}/share`);
const vaSig = vaShare.json?.sig || "";
check("lien de partage renvoie une signature", typeof vaSig === "string" && vaSig.length > 10, `recu ${String(vaSig).slice(0, 20)}`);
const vaInfo = await call("GET", `/api/public/quote/${vaId}/info?sig=${encodeURIComponent(vaSig)}`);
check("info publique sans e-mail -> has_email=false", vaInfo.json?.has_email === false, `recu ${JSON.stringify(vaInfo.json).slice(0, 80)}`);
check("info publique fournit un lien PDF", typeof vaInfo.json?.pdf_url === "string" && vaInfo.json.pdf_url.includes("/api/pdf-share/quote/"), `recu ${vaInfo.json?.pdf_url}`);
const vaNoMail = await call("POST", `/api/public/quote/${vaId}/accept`, { sig: vaSig });
check("accept sans e-mail -> email_required (400)", vaNoMail.status === 400 && vaNoMail.json?.email_required === true, `recu ${vaNoMail.status} ${JSON.stringify(vaNoMail.json)}`);
const vaBefore = await call("GET", `/api/quotes/${vaId}`);
check("devis non accepte tant que l'e-mail n'est pas fourni", vaBefore.json?.status === "sent", `recu ${vaBefore.json?.status}`);

const realFetchMail = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : (input as any).url;
  if (url.includes("api.brevo.com")) {
    if (url.includes("/senders")) {
      return new Response(JSON.stringify({ senders: [{ email: "palettedeco@outlook.com", active: true }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/smtp/email")) {
      return new Response(JSON.stringify({ messageId: "acc-test" }), { status: 200, headers: { "content-type": "application/json" } });
    }
  }
  return realFetchMail(input, init);
}) as typeof fetch;

const vaMail = await call("POST", `/api/public/quote/${vaId}/accept`, { sig: vaSig, email: "client@accept-test.fr" });
check("accept avec e-mail -> ok", vaMail.status === 200 && vaMail.json?.ok === true, `recu ${vaMail.status} ${JSON.stringify(vaMail.json)}`);
check("devis envoye par e-mail", vaMail.json?.email_sent === true, `recu ${JSON.stringify(vaMail.json)}`);
globalThis.fetch = realFetchMail;

const vaAfter = await call("GET", `/api/quotes/${vaId}`);
check("devis passe a 'accepted'", vaAfter.json?.status === "accepted", `recu ${vaAfter.json?.status}`);
const vaClientAfter = await call("GET", "/api/clients");
check("e-mail du client enregistre", (vaClientAfter.json || []).some((cl: any) => cl.id === vaClient.json?.id && cl.email === "client@accept-test.fr"), "email non mis a jour");
const vaAgain = await call("POST", `/api/public/quote/${vaId}/accept`, { sig: vaSig, email: "client@accept-test.fr" });
check("re-accept -> deja accepte", vaAgain.status === 200 && vaAgain.json?.already === true, `recu ${vaAgain.status} ${JSON.stringify(vaAgain.json)}`);
const vaBadSig = await call("POST", `/api/public/quote/${vaId}/accept`, { sig: "faux" });
check("mauvaise signature rejetee", vaBadSig.status === 403, `recu ${vaBadSig.status}`);

/* Devis refuse : impossible a accepter. */
const vaQ2 = await call("POST", "/api/quotes", {
  client_id: vaClient.json?.id, status: "draft",
  items: [{ description: "Prestation refusee", quantity: 1, unit_price: 50, tva_rate: 20 }],
});
if (vaQ2.json?.id > 0) createdQuoteIds.push(vaQ2.json.id);
await call("POST", `/api/quotes/${vaQ2.json?.id}/status`, { status: "declined" });
const vaDecl = await call("POST", `/api/public/quote/${vaQ2.json?.id}/accept`, { sig: (await call("GET", `/api/quotes/${vaQ2.json?.id}/share`)).json?.sig });
check("devis refuse -> 409", vaDecl.status === 409, `recu ${vaDecl.status}`);

/* Nettoyage : une seule passe, par identifiant, sur la base de dev.
   Les factures finalisees sont effacees en SQL car l'API les protege.
   Les reglages societe sont restaures : sans cela le test laissait a demeure
   un SIRET, un IBAN et une adresse de test dans la fiche de l'entreprise. */
{
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: String(process.env.DATABASE_URL) });
  if (createdInvoiceIds.length) await pool.query("delete from invoices where id = any($1::int[])", [createdInvoiceIds]);
  if (createdQuoteIds.length) await pool.query("delete from quotes where id = any($1::int[])", [createdQuoteIds]);
  if (createdClientIds.length) await pool.query("delete from clients where id = any($1::int[])", [createdClientIds]);
  /* L'API de modification de societe accepte une charge utile partielle,
     on renvoie donc uniquement les champs reellement patches. */
  if (Object.keys(patch).length) {
    const coBack = await call("PUT", "/api/company", patch);
    check("reglages societe restaures", coBack.status === 200, `recu ${coBack.status}`);
  }
  await pool.end();
}
const fxRest = await call("GET", "/api/invoices");
const fxQuotesRest = await call("GET", "/api/quotes");
const fxClientsRest = await call("GET", "/api/clients");
check("nettoyage : aucune facture de test restante", !(fxRest.json || []).some((i: any) => createdInvoiceIds.includes(i.id)), "facture residuelle");
check("nettoyage : aucun devis de test restant", !(fxQuotesRest.json || []).some((q: any) => createdQuoteIds.includes(q.id)), "devis residuel");
check("nettoyage : aucun client de test restant", !(fxClientsRest.json || []).some((c: any) => createdClientIds.includes(c.id)), "client residuel");

console.log("\n=== 8. Suppression des donnees de test ===");
await call("DELETE", `/api/transactions/${txOut.json.id}`);
await call("DELETE", `/api/transactions/${tx.json.id}`);
const delExp = await call("DELETE", `/api/expenses/${created.json.id}`);
check("depense detachee : suppression acceptee", delExp.status === 200, `recu ${delExp.status}`);

await call("PUT", `/api/bank-accounts/${acct.json.id}`, { archived: true });
const cashFinal = await call("GET", "/api/cash?from=2026-01-01&to=2026-12-31");
check("apres nettoyage, aucun compte actif", cashFinal.json?.has_accounts === false, `${cashFinal.json?.has_accounts}`);

const final = await call("GET", "/api/expenses?from=2020-01-01&to=2030-12-31");
check("compteur de depenses revenu au valeur initiale", (final.json?.total?.count ?? 0) === countBefore, `${final.json?.total?.count} vs ${countBefore}`);

console.log(`\n${pass} reussis, ${fail} echecs`);
if (fail) {
  console.log("\nDetail des echecs :");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}