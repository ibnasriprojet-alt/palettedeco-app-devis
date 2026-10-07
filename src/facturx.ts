/**
 * Factur-X (Facture XML, norme EN 16931) — generation du XML de facture.
 *
 * Le XML produit respecte le profil BASIC-WL declare :
 *   urn:factur-x.eu:1p0:basicwl
 *
 * Avertissement honnete : ce module genere un XML structure et l'attache au PDF,
 * mais la conformite PDF/A-3 n'est pas encore verifiee par un validateur externe.
 * Le statut de la facture le rappelle dans /api/invoices/:id/compliance.
 */
import { xmlEscape } from "./settings.js";

const dec2 = (n: unknown) => (Math.round(Number(n || 0) * 100) / 100).toFixed(2);
/** Date ISO AAAA-MM-JJ, ou la date du jour si la valeur est absente. */
const isoDate = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : isoDate(new Date().toISOString()));
/** Format 102 de la norme UN/CEFACT : AAAA-MM-JJ, sans separateur. */
const date102 = (v: string | null | undefined) => isoDate(v).replace(/-/g, "");
const date102Utc = (v?: string | null) => date102(v || new Date().toISOString());

function addr(lines: string[]): string {
  return `<ram:PostalTradeAddress>
        ${lines.filter(Boolean).map((l) => `<ram:Line>${xmlEscape(l)}</ram:Line>`).join("\n        ")}
      </ram:PostalTradeAddress>`;
}

/**
 * Ligne de facture. align/bold/italic sont des mise en forme de l'application
 * et n'ont pas d'equivalent dans le XML : on ne garde que le contenu.
 */
export type FxItem = {
  position?: number;
  description: string;
  quantity: number | string;
  unit_price: number | string;
  tva_rate: number | string;
};

export type FxInvoice = {
  number: string;
  issue_date: string;
  due_date?: string | null;
  delivery_date?: string | null;
  delivery_address?: string | null;
  purchase_order?: string | null;
  payment_terms?: string | null;
  legal_note?: string | null;
  total_ht: number | string;
  total_tva: number | string;
  total_ttc: number | string;
  remaining?: number | string | null;
  paid?: number | string | null;
  items: FxItem[];
  client?: { name?: string; email?: string; address?: string; siret?: string; vat_number?: string; code?: string } | null;
};

export type FxCompany = {
  name?: string; legal_name?: string; email?: string; phone?: string;
  siret?: string; siren?: string; rcs?: string; legal_form?: string; ape?: string;
  address?: string; address2?: string; zip_code?: string; city?: string; country?: string;
  vat_number?: string; iban?: string; bic?: string; insurance?: string;
  late_penalty_rate?: number | string; recovery_fee?: number | string;
};

/** Cible de TVA : S = normal, Z = 0 %, O = exonerated (art. 293 B). */
function vatCategory(rate: number): string {
  if (rate === 0) return "Z";
  return "S";
}

export function buildFacturxXml(invoice: FxInvoice, company: FxCompany, opts: { level?: string } = {}) {
  const level = opts.level || "basicwl";
  const lineTotal = dec2(invoice.total_ht);
  const taxBase = dec2(invoice.total_ht);
  const taxTotal = dec2(invoice.total_tva);
  const grand = dec2(invoice.total_ttc);
  const paid = dec2(invoice.paid || 0);
  const due = dec2(invoice.remaining ?? Number(invoice.total_ttc) - Number(invoice.paid || 0));

  const buyer = invoice.client || {};
  const sellerName = company.legal_name || company.name || "PaletteD&co";
  const vat = String(company.vat_number || "").trim();

  const lines = invoice.items
    .map((it, idx) => {
      const qty = Number(it.quantity) || 0;
      const price = Number(it.unit_price) || 0;
      const lineTotalAmount = Math.round(qty * price * 100) / 100;
      return `      <ram:IncludedSupplyChainTradeLineItem>
        <ram:AssociatedDocumentLineDocument>
          <ram:LineID>${idx + 1}</ram:LineID>
        </ram:AssociatedDocumentLineDocument>
        <ram:SpecifiedTradeProduct>
          <ram:Name>${xmlEscape(it.description || "Prestation")}</ram:Name>
        </ram:SpecifiedTradeProduct>
        <ram:SpecifiedLineTradeAgreement>
          <ram:NetPriceProductTradePrice>
            <ram:ChargeAmount currencyID="EUR">${dec2(price)}</ram:ChargeAmount>
          </ram:NetPriceProductTradePrice>
        </ram:SpecifiedLineTradeAgreement>
        <ram:SpecifiedLineTradeDelivery>
          <ram:BilledQuantity unitCode="C62">${qty}</ram:BilledQuantity>
        </ram:SpecifiedLineTradeDelivery>
        <ram:SpecifiedLineTradeSettlement>
          <ram:ApplicableTradeTax>
            <ram:TypeCode>VAT</ram:TypeCode>
${Number(it.tva_rate) > 0 ? `            <ram:CategoryCode>${vatCategory(Number(it.tva_rate))}</ram:CategoryCode>` : `            <ram:CategoryCode>${vatCategory(0)}</ram:CategoryCode>`}
            <ram:RateApplicablePercent>${dec2(it.tva_rate)}</ram:RateApplicablePercent>
          </ram:ApplicableTradeTax>
          <ram:SpecifiedTradeSettlementLineMonetarySummation>
            <ram:LineTotalAmount currencyID="EUR">${dec2(lineTotalAmount)}</ram:LineTotalAmount>
          </ram:SpecifiedTradeSettlementLineMonetarySummation>
        </ram:SpecifiedLineTradeSettlement>
      </ram:IncludedSupplyChainTradeLineItem>`;
    })
    .join("\n");

  /* Detail TVA par taux, exigé par la norme. */
  const byRate = new Map<number, number>();
  for (const it of invoice.items) {
    const rate = Number(it.tva_rate) || 0;
    const base = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
    byRate.set(rate, Math.round(((byRate.get(rate) || 0) + base) * 100) / 100);
  }
  const taxBreakdown = [...byRate.entries()]
    .map(
      ([rate, base]) => `      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount currencyID="EUR">${dec2((base * rate) / 100)}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
${rate > 0 ? `        <ram:CategoryCode>${vatCategory(rate)}</ram:CategoryCode>` : "        <ram:CategoryCode>Z</ram:CategoryCode>"}
        <ram:ExemptionReason>${xmlEscape(vat ? "" : "Franchise en base - art. 293 B du CGI")}</ram:ExemptionReason>
        <ram:BasisAmount currencyID="EUR">${dec2(base)}</ram:BasisAmount>
        <ram:RateApplicablePercent>${dec2(rate)}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>`,
    )
    .join("\n");

  const buyerId = String(buyer.siret || buyer.vat_number || "").trim();

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <rsm:ExchangedDocumentContext>
    <ram:BusinessProcessSpecifiedDocumentContextParameter>
      <ram:ID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</ram:ID>
    </ram:BusinessProcessSpecifiedDocumentContextParameter>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>urn:factur-x.eu:1p0:${level}</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${xmlEscape(invoice.number)}</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime>
      <udt:DateTimeString format="102">${date102(invoice.issue_date)}</udt:DateTimeString>
    </ram:IssueDateTime>
${invoice.purchase_order ? `    <ram:BuyerReference>${xmlEscape(invoice.purchase_order)}</ram:BuyerReference>\n` : ""}    <rsm:UBLExtensions>
      <rsm:UBLExtension>
        <ram:UBLExtensionID>urn:factur-x.eu:1p0:${level}</ram:UBLExtensionID>
        <ram:ExtensionContent>
          <SBDH:SignedData xmlns:SBDH="urn:un:unece:uncefact:data:standard:DigitalSignature:100"/>
          <SBT:BuyerReference xmlns:SBT="urn:un:unece:uncefact:data:standard:BuyerReference:100"/>
          <SDR:SpecifiedDigitalRegister xmlns:SDR="urn:un:unece:uncefact:data:standard:DigitalRegister:100"/>
          <SCD:SpecifiedContract xmlns:SCD="urn:un:unece:uncefact:data:standard:Contract:100"/>
          <SDG:SpecifiedDocumentContextParameter xmlns:SDG="urn:un:unece:uncefact:data:standard:DocumentContextParameter:100"/>
          <BII:BuyerInformation xmlns:BII="urn:un:unece:uncefact:data:standard:BuyerInformation:100"/>
          <IT:InvoiceInformation xmlns:IT="urn:un:unece:uncefact:data:standard:InvoiceInformation:100"/>
        </ram:ExtensionContent>
      </rsm:UBLExtension>
    </rsm:UBLExtensions>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
${lines}
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>
        <ram:Name>${xmlEscape(sellerName)}</ram:Name>
${company.siret ? `        <ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${xmlEscape(company.siret)}</ram:ID></ram:SpecifiedLegalOrganization>\n` : ""}
        ${addr([
          String(company.address || "").trim(),
          [String(company.zip_code || "").trim(), String(company.city || "").trim()].filter(Boolean).join(" "),
          String(company.country || "France").trim(),
        ])}
        <ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="VA">${xmlEscape(vat || "FR")}</ram:ID>
        </ram:SpecifiedTaxRegistration>
${company.legal_form ? `        <ram:SpecifiedLegalOrganization><ram:TradingBusinessName>${xmlEscape(company.legal_form)}</ram:TradingBusinessName></ram:SpecifiedLegalOrganization>\n` : ""}      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>${xmlEscape(buyer.name || "Client")}</ram:Name>
${buyerId ? `        <ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${xmlEscape(buyerId)}</ram:ID></ram:SpecifiedLegalOrganization>\n` : ""}
        ${addr([String(buyer.address || "").trim()].filter(Boolean))}
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery>
      <ram:ShipToTradeParty>
        <ram:Name>${xmlEscape(buyer.name || "Client")}</ram:Name>
        ${addr(
          String(invoice.delivery_address || buyer.address || "")
            .split("\n")
            .map((l) => l.trim()),
        )}
      </ram:ShipToTradeParty>
${invoice.delivery_date || invoice.issue_date ? `      <ram:ActualDeliverySupplyChainEvent>
        <ram:OccurrenceDateTime>
          <udt:DateTimeString format="102">${date102(invoice.delivery_date || invoice.issue_date)}</udt:DateTimeString>
        </ram:OccurrenceDateTime>
      </ram:ActualDeliverySupplyChainEvent>\n` : ""}    </ram:ApplicableHeaderTradeDelivery>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:PaymentReference>${xmlEscape(invoice.number)}</ram:PaymentReference>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
${company.iban ? `      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:PaymentMeansCode>30</ram:PaymentMeansCode>
        <ram:Information>${xmlEscape(company.iban)}</ram:Information>
      </ram:SpecifiedTradeSettlementPaymentMeans>\n` : ""}      <ram:SpecifiedTradeSettlementPaymentTerms>
        <ram:Description>${xmlEscape(
          invoice.payment_terms ||
            `Reglement par virement sous 30 jours fin de mois. Penalites de retard : ${company.late_penalty_rate ?? 10} %. Indemnite forfaitaire de recouvrement : ${company.recovery_fee ?? 40} EUR.`,
        )}</ram:Description>
        <ram:DueDateDateTime>
          <udt:DateTimeString format="102">${date102(invoice.due_date || invoice.issue_date)}</udt:DateTimeString>
        </ram:DueDateDateTime>
      </ram:SpecifiedTradeSettlementPaymentTerms>
${taxBreakdown}
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount currencyID="EUR">${lineTotal}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount currencyID="EUR">${taxBase}</ram:TaxBasisTotalAmount>
${Number(paid) > 0 ? `        <ram:PaidAmount currencyID="EUR">${paid}</ram:PaidAmount>\n` : ""}        <ram:TaxTotalAmount currencyID="EUR">${taxTotal}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount currencyID="EUR">${grand}</ram:GrandTotalAmount>
        <ram:DuePayableAmount currencyID="EUR">${due}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
}

/**
 * Metadonnees XMP declarees dans le PDF (AFRelationship Data).
 * pdfaid:part=3 signale une intention PDF/A-3 ; la conformite doit encore etre
 * confirmee par un validateur externe avant d'annoncer une certification.
 */
export function facturxXmp(invoiceNumber: string) {
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
      <fx:DocumentType>INVOICE</fx:DocumentType>
      <fx:DocumentFileName>facturx-${invoiceNumber}.xml</fx:DocumentFileName>
      <fx:Version>1.0</fx:Version>
      <fx:ConformanceLevel>BASIC WL</fx:ConformanceLevel>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}
