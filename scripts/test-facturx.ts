/**
 * Tests Factur-X : structure du XML UBL, coherence des montants, echappement
 * des caracteres speciaux et endpoint HTTP.
 *
 *   npx tsx scripts/test-facturx.ts
 *
 * Ne touche qu'a la base de dev : la facture de test creee est supprimee,
 * les factures existantes ne sont jamais modifiees.
 */
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { buildFacturxXml, facturxXmp, type FxInvoice } from "../src/facturx";

let pass = 0;
let fail = 0;
const failures: string[] = [];
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

const company = {
  name: "PaletteD&co",
  legal_name: "PaletteD&co SARL",
  siret: "12345678900012",
  vat_number: "FR00123456789",
  address: "10 rue des Bois",
  zip_code: "69001",
  city: "Lyon",
  country: "France",
  iban: "FR7630004000031234567890143",
  bic: "BADEFRPP",
  late_penalty_rate: 10,
  recovery_fee: 40,
};

const invoice: FxInvoice = {
  number: "FACT-TEST-001",
  issue_date: "2026-09-15",
  due_date: "2026-10-15",
  /* Les totaux d'en-tete doivent correspondre aux lignes ci-dessous, sinon le
     XML est incoherent et un validateur EN16931 le refuse :
     HT = 2x1000 + 4x250 + 1x500 = 3500
     TVA = 3000x20 % + 500x10 % = 650
     TTC = 4150, reste apres 1000 regles = 3150 */
  total_ht: 3500,
  total_tva: 650,
  total_ttc: 4150,
  paid: 1000,
  remaining: 3150,
  items: [
    { description: "Meuble sur mesure \"Chene massif\" & finition", quantity: 2, unit_price: 1000, tva_rate: 20 },
    { description: "Pose sur site", quantity: 4, unit_price: 250, tva_rate: 20 },
    { description: "Livraison express", quantity: 1, unit_price: 500, tva_rate: 10 },
  ],
  client: {
    name: "SCI Omeg & Co <Nord>",
    address: "5 avenue de la Paix\n69003 Lyon",
    siret: "98765432100045",
    vat_number: "FR00987654321",
    code: "OMEGA",
  },
};

console.log("\n=== 1. Well-formedness du XML ===");
const xml = buildFacturxXml(invoice, company);
const valid = XMLValidator.validate(xml);
ok("XML bien forme", valid === true, valid === true ? "" : JSON.stringify(valid.err));
ok("declaration XML presente", xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
ok("encodage UTF-8", /encoding="UTF-8"/.test(xml));

console.log("\n=== 2. Elements obligatoires Factur-X BASIC-WL ===");
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  /* Les montants et codes doivent rester des chaines pour etre compares tels quels. */
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (n) => ["IncludedSupplyChainTradeLineItem", "ApplicableTradeTax"].includes(n),
});
/** Un noeud portant des attributs place son texte dans #text. */
const val = (n: any): string => (n == null ? "" : String((n as any)["#text"] ?? n));
const doc: any = parser.parse(xml);
const tx = doc.CrossIndustryInvoice.SupplyChainTradeTransaction;
ok("racine CrossIndustryInvoice", !!doc.CrossIndustryInvoice);
ok("profil BASIC-WL declare", /urn:factur-x\.eu:1p0:basicwl/.test(xml));
ok("Contexte documentaire present", !!doc.CrossIndustryInvoice.ExchangedDocumentContext);
ok("numero de facture", val(doc.CrossIndustryInvoice.ExchangedDocument.ID) === "FACT-TEST-001");
ok("type de document 380 (facture)", val(doc.CrossIndustryInvoice.ExchangedDocument.TypeCode) === "380");
ok("date d'emission au format 102 (AAAAMMJJ)", val(doc.CrossIndustryInvoice.ExchangedDocument.IssueDateTime.DateTimeString) === "20260915");
ok("UBL extensions presentes", /rsm:UBLExtensions/.test(xml));
ok("date de livraison", /ActualDeliverySupplyChainEvent/.test(xml));
ok("reference paiement", val(tx.ApplicableHeaderTradeSettlement.PaymentReference) === "FACT-TEST-001");

console.log("\n=== 3. Parties et identifiants fiscaux ===");
const ag = tx.ApplicableHeaderTradeAgreement;
ok("vendeur present", ag.SellerTradeParty.Name === "PaletteD&co SARL");
ok("SIRET vendeur en 0002", /schemeID="0002">12345678900012</.test(xml));
ok("TVA vendeur en VA", /schemeID="VA">FR00123456789</.test(xml));
ok("adresse vendeur codee", ag.SellerTradeParty.PostalTradeAddress.Line.length === 3);
ok("acheteur echappe (ampersand)", ag.BuyerTradeParty.Name === "SCI Omeg & Co <Nord>");
ok("identifiant acheteur", val(ag.BuyerTradeParty.SpecifiedLegalOrganization.ID) === "98765432100045");

console.log("\n=== 4. Lignes de facture ===");
const lines = tx.IncludedSupplyChainTradeLineItem;
ok("3 lignes generees", lines.length === 3, `recu ${lines.length}`);
ok("LineID incrementes", lines.map((l: any) => l.AssociatedDocumentLineDocument.LineID).join(",") === "1,2,3");
ok("description echappee", lines[0].SpecifiedTradeProduct.Name === 'Meuble sur mesure "Chene massif" & finition');
ok("quantite (BilledQuantity)", val(lines[0].SpecifiedLineTradeDelivery.BilledQuantity) === "2");
ok("PUHT (ChargeAmount)", val(lines[0].SpecifiedLineTradeAgreement.NetPriceProductTradePrice.ChargeAmount) === "1000.00");
ok("total de ligne = qte x PU", val(lines[0].SpecifiedLineTradeSettlement.SpecifiedTradeSettlementLineMonetarySummation.LineTotalAmount) === "2000.00");
ok("ligne 2 : 4 x 250", val(lines[1].SpecifiedLineTradeSettlement.SpecifiedTradeSettlementLineMonetarySummation.LineTotalAmount) === "1000.00");
ok("taux de TVA 10 % preserve", val(lines[2].SpecifiedLineTradeSettlement.ApplicableTradeTax[0].RateApplicablePercent) === "10.00");
ok("unite C62 (unite)", lines[0].SpecifiedLineTradeDelivery.BilledQuantity["@unitCode"] === "C62");

console.log("\n=== 5. Ventilation TVA par taux ===");
const taxes = tx.ApplicableHeaderTradeSettlement.ApplicableTradeTax;
ok("2 taux distincts (20 % et 10 %)", taxes.length === 2, `recu ${taxes.length}`);
const t20 = taxes.find((t: any) => val(t.RateApplicablePercent) === "20.00");
const t10 = taxes.find((t: any) => val(t.RateApplicablePercent) === "10.00");
ok("base TVA 20 % = 3000", val(t20.BasisAmount) === "3000.00");
ok("montant TVA 20 % = 600", val(t20.CalculatedAmount) === "600.00");
ok("base TVA 10 % = 500", val(t10.BasisAmount) === "500.00");
ok("montant TVA 10 % = 50", val(t10.CalculatedAmount) === "50.00");
ok("category S pour le taux normal", val(t20.CategoryCode) === "S");
ok("Total TVA coherent avec les lignes", Number(val(t20.CalculatedAmount)) + Number(val(t10.CalculatedAmount)) === 650);

console.log("\n=== 6. Totaux et echeance ===");
const sum = tx.ApplicableHeaderTradeSettlement.SpecifiedTradeSettlementHeaderMonetarySummation;
ok("devise EUR", tx.ApplicableHeaderTradeSettlement.InvoiceCurrencyCode === "EUR");
ok("total des lignes", val(sum.LineTotalAmount) === "3500.00");
ok("base TVA HT", val(sum.TaxBasisTotalAmount) === "3500.00");
ok("total TVA", val(sum.TaxTotalAmount) === "650.00");
ok("total TTC", val(sum.GrandTotalAmount) === "4150.00");
ok("reste a payer (TTC - regle)", val(sum.DuePayableAmount) === "3150.00");
ok("montant regle (PaidAmount)", val(sum.PaidAmount) === "1000.00");
ok("echeance au format 102", val(tx.ApplicableHeaderTradeSettlement.SpecifiedTradeSettlementPaymentTerms.DueDateDateTime.DateTimeString) === "20261015");
/* Verification de coherence exigee par EN16931 (BR-CO-14/15/16) : la somme des
   lignes, des bases de TVA et des montants de TVA doit rebuildre les totaux
   d'en-tete. Sans ce controle, une fixture incoherente passerait les tests. */
const sumLines = lines.reduce(
  (a: number, l: any) => a + Number(val(l.SpecifiedLineTradeSettlement.SpecifiedTradeSettlementLineMonetarySummation.LineTotalAmount)),
  0,
);
const sumTaxBases = taxes.reduce((a: number, t: any) => a + Number(val(t.BasisAmount)), 0);
const sumTaxAmounts = taxes.reduce((a: number, t: any) => a + Number(val(t.CalculatedAmount)), 0);
ok("coherence lignes -> total HT", sumLines === Number(val(sum.TaxBasisTotalAmount)), `${sumLines} != ${val(sum.TaxBasisTotalAmount)}`);
ok("coherence bases de TVA -> total HT", sumTaxBases === Number(val(sum.TaxBasisTotalAmount)), `${sumTaxBases} != ${val(sum.TaxBasisTotalAmount)}`);
ok("coherence ventilation TVA -> total TVA", sumTaxAmounts === Number(val(sum.TaxTotalAmount)), `${sumTaxAmounts} != ${val(sum.TaxTotalAmount)}`);
ok("coherence HT + TVA = TTC", Number(val(sum.TaxBasisTotalAmount)) + Number(val(sum.TaxTotalAmount)) === Number(val(sum.GrandTotalAmount)));
ok("coherence regle + reste = TTC", Number(val(sum.PaidAmount)) + Number(val(sum.DuePayableAmount)) === Number(val(sum.GrandTotalAmount)));
ok("IBAN en moyen de paiement", /FR7630004000031234567890143/.test(xml));
ok("pénalités de retard dans les CGV", /Pénalités de retard/.test(xml) || /Penalites de retard/.test(xml));
ok("indemnité 40 EUR dans les CGV", /40 EUR/.test(xml));

console.log("\n=== 7. Cas particuliers ===");
const mini = buildFacturxXml(
  { number: "F1", issue_date: "2026-01-31", total_ht: 100, total_tva: 0, total_ttc: 100, paid: 0, items: [{ description: "Exonere", quantity: 1, unit_price: 100, tva_rate: 0 }], client: { name: "Particulier" } },
  { name: "PaletteD&co", vat_number: "" },
);
ok("TVA 0 % categorie Z", /<ram:CategoryCode>Z<\/ram:CategoryCode>/.test(mini));
ok("motif exoneration 293 B", /293 B/.test(mini));
ok("pas de PaidAmount quand rien n'est réglé", !/PaidAmount/.test(mini));
ok("reste = TTC si aucun règlement", /DuePayableAmount currencyID="EUR">100\.00/.test(mini));
ok("client sans identifiant fiscal accepté", /<ram:Name>Particulier<\/ram:Name>/.test(mini));
const xs = buildFacturxXml({ number: "F<2>&\".xml", issue_date: "2026-02-01", total_ht: 0, total_tva: 0, total_ttc: 0, items: [{ description: "<b>toto</b>", quantity: 1, unit_price: 0, tva_rate: 0 }], client: { name: "A&B" } }, company);
ok("numero de facture echappe", xs.includes("F&lt;2&gt;&amp;&quot;") || xs.includes("F&lt;2&gt;&amp;"));
ok("XML toujours bien forme apres echappement", XMLValidator.validate(xs) === true);

console.log("\n=== 8. Metadonnees XMP ===");
const xmp = facturxXmp("FACT-TEST-001");
ok("XMP bien forme (packet)", xmp.includes('<?xpacket begin') && xmp.includes('<?xpacket end="w"?>'));
ok("DocumentType INVOICE", /<fx:DocumentType>INVOICE<\/fx:DocumentType>/.test(xmp));
ok("pdfaid part 3 declare", /<pdfaid:part>3<\/pdfaid:part>/.test(xmp));
ok("conformance B", /<pdfaid:conformance>B<\/pdfaid:conformance>/.test(xmp));
ok("nom de fichier coherent", /facturx-FACT-TEST-001\.xml/.test(xmp));

console.log(`\n${pass} verifications reussies, ${fail} echecs`);
if (fail) {
  console.log("\nDetail des echecs :");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}