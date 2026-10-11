import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, BASE, statusColors, statusLabels } from "../lib/api";
import type { Client, Company, Invoice, Order, Payment, Quote } from "../lib/types";
import { fmt, fmtDate, money, round2, today } from "../lib/format";
import { Badge, Button, Card, Field, PageHeader, Spinner, inputCls } from "../components/ui";
import { ArrowLeft, Download, FileText, Link2, Mail, MessageCircle, Plus, Printer, Share2, Trash2 } from "lucide-react";
import { cn } from "../lib/cn";

type Kind = "quote" | "invoice" | "order";

export default function DocumentView({ kind }: { kind: Kind }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const docId = Number(id);

  const [company, setCompany] = useState<Company | null>(null);
  const [doc, setDoc] = useState<Quote | Invoice | Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [converting, setConverting] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailCopy, setEmailCopy] = useState(false);
  const [emailMsg, setEmailMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [shareMsg, setShareMsg] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [waMsg, setWaMsg] = useState("");
  const [payForm, setPayForm] = useState({ amount: "", method: "Virement", date: today(), note: "" });

  const isQuote = kind === "quote";
  const isOrder = kind === "order";
  const isInvoice = kind === "invoice";

  useEffect(() => {
    setLoading(true);
    /* Le composant est preserve quand on change de document (meme route /:id) :
       sans ces resets, l'ancien devis restait affiche et le destinataire e-mail
       de l'ancien client etait conserve. */
    setError("");
    setDoc(null);
    setEmailTo("");
    setEmailMsg(null);
    setShareMsg("");
    setShareUrl("");
    setWaMsg("");
    setInvoiceNumber("");
    setPayForm({ amount: "", method: "Virement", date: today(), note: "" });
    let alive = true;
    Promise.all([
      api.getCompany(),
      isQuote ? api.getQuote(docId) : isOrder ? api.getOrder(docId) : api.getInvoice(docId),
    ])
      .then(([com, d]) => {
        if (!alive) return;
        setCompany(com);
        setDoc(d as Quote | Invoice | Order);
      })
      .catch((e) => {
        if (alive) setError((e as Error).message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, kind]);

  useEffect(() => {
    setEmailTo(doc?.client?.email || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.client?.email]);

  const byRate = useMemo(() => {
    const m: Record<string, { rate: number; base: number; tva: number }> = {};
    for (const it of doc?.items || []) {
      const qty = round2(it.quantity);
      const unit = round2(it.unit_price);
      const rate = round2(it.tva_rate);
      const base = money(qty * unit);
      const k = String(rate);
      m[k] = m[k] || { rate, base: 0, tva: 0 };
      m[k].base = money(m[k].base + base);
      m[k].tva = money(m[k].tva + money(base * (rate / 100)));
    }
    return Object.values(m).filter((r) => r.base > 0);
  }, [doc]);

  const client: Client | null | undefined = doc?.client;

  async function setStatus(status: string) {
    if (!doc) return;
    try {
      const updated = isQuote
        ? await api.setQuoteStatus(doc.id, status as never)
        : isOrder
          ? await api.setOrderStatus(doc.id, status as never)
          : await api.setInvoiceStatus(doc.id, status as never);
      setDoc({ ...doc, ...updated } as Quote | Invoice | Order);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function convert() {
    if (!doc || isInvoice) return;
    setConverting(true);
    try {
      const inv = isQuote ? await api.convertQuote(doc.id, invoiceNumber) : await api.convertOrder(doc.id, invoiceNumber);
      navigate(`/invoices/${inv.id}`);
    } catch (e) {
      setError((e as Error).message);
      setConverting(false);
    }
  }

  async function downloadPdf() {
    if (!doc) return;
    try {
      const { url, filename } = await api.downloadPdf(isQuote ? "quote" : isOrder ? "order" : "invoice", doc.id, doc.number);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function sendMail() {
    if (!doc || !emailTo.trim()) return;
    setEmailMsg(null);
    setError("");
    try {
      await api.sendDocument(isQuote ? "quote" : isOrder ? "order" : "invoice", doc.id, emailTo.trim(), emailCopy);
      setEmailMsg({ ok: true, text: "E-mail envoyé avec le PDF joint." });
    } catch (e) {
      setEmailMsg({ ok: false, text: (e as Error).message });
    }
  }

  async function shareLink() {
    if (!doc) return;
    setShareMsg("");
    setError("");
    try {
      const { sig } = await api.shareQuote(doc.id);
      const url = `${location.origin}/accept/${doc.id}?sig=${encodeURIComponent(sig)}`;
      setShareUrl(url);
      try {
        await navigator.clipboard.writeText(url);
        setShareMsg("Lien copié dans le presse-papiers !");
      } catch {
        setShareMsg("Copiez le lien ci-dessous pour l'envoyer au client.");
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function shareWhatsApp() {
    if (!doc) return;
    const url = shareUrl || (async () => {
      const { sig } = await api.shareQuote(doc.id);
      return `${location.origin}/accept/${doc.id}?sig=${encodeURIComponent(sig)}`;
    })();
    const link = typeof url === "string" ? url : await url;
    setShareUrl(link);
    const text = `Bonjour,\nvoici le lien pour consulter et valider votre devis ${doc.number} :\n${link}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  }

  async function publicPdfUrl(): Promise<string> {
    if (!doc) throw new Error("Document introuvable");
    const { url } = await api.getPublicPdfUrl(isQuote ? "quote" : isOrder ? "order" : "invoice", doc.id);
    return `${BASE}${url}`;
  }

  async function whatsApp() {
    if (!doc) return;
    setError("");
    setWaMsg("");
    /* La fenetre doit etre ouverte pendant le geste utilisateur : apres un
       "await" le navigateur bloque le popup. On l'ouvre donc en synchrone. */
    const win = window.open("about:blank", "_blank");
    if (!win) {
      setError("La fenetre a ete bloquee. Autorisez les pop-ups pour ce site.");
      return;
    }
    try {
      const abs = await publicPdfUrl();
      const label = isQuote ? "devis" : isOrder ? "bon de commande" : "facture";
      const text = `Bonjour,\nvoici votre ${label} ${doc.number} :\n${abs}`;
      win.location.href = `https://wa.me/?text=${encodeURIComponent(text)}`;
      setWaMsg("WhatsApp ouvert — le lien du PDF est dans le message.");
    } catch (e) {
      win.close();
      setError((e as Error).message);
    }
  }

  async function copyPdfLink() {
    if (!doc) return;
    setError("");
    setWaMsg("");
    try {
      const abs = await publicPdfUrl();
      await navigator.clipboard.writeText(abs);
      setWaMsg("Lien du PDF copié !");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function reloadDoc() {
    if (!doc) return;
    const fresh = isQuote ? await api.getQuote(doc.id) : isOrder ? await api.getOrder(doc.id) : await api.getInvoice(doc.id);
    setDoc(fresh as Quote | Invoice | Order);
  }

  async function addPayment() {
    if (!doc) return;
    const amount = round2(Number(payForm.amount));
    if (!amount || amount <= 0) return;
    setError("");
    try {
      await api.addPayment(doc.id, {
        amount,
        method: payForm.method || "Virement",
        date: payForm.date || today(),
        note: payForm.note,
      });
      setPayForm({ amount: "", method: payForm.method, date: payForm.date, note: "" });
      await reloadDoc();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function removePayment(pid: number) {
    if (!doc) return;
    if (!confirm("Supprimer ce paiement ?")) return;
    setError("");
    try {
      await api.deletePayment(doc.id, pid);
      await reloadDoc();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function removeInvoice() {
    if (!doc || !isInvoice) return;
    if (!confirm(`Supprimer définitivement la facture ${doc.number} ? Action irréversible.`)) return;
    setError("");
    try {
      await api.deleteInvoice(doc.id);
      navigate("/invoices");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const invoice = isInvoice ? (doc as Invoice | null) : null;
  const paidTotal = invoice ? money(Number(invoice.paid ?? 0)) : 0;
  const overall = invoice
    ? {
        paid: paidTotal,
        remaining: money(invoice.remaining ?? (Number(invoice.total_ttc) - Number(invoice.paid ?? 0))),
        pct: Math.min(100, Math.round((paidTotal / Math.max(1, money(Number(invoice.total_ttc)))) * 100)),
      }
    : null;

  return (
    <div className="print-root">
      <div className="no-print mx-auto mb-4 max-w-5xl">
        <PageHeader
          title={isQuote ? "Aperçu du devis" : isOrder ? "Aperçu du bon de commande" : "Aperçu de la facture"}
          subtitle={doc ? doc.number : ""}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Link to={isQuote ? "/quotes" : isOrder ? "/orders" : "/invoices"} className="inline-flex items-center gap-1.5 rounded-lg border border-line-2 px-3 py-2 text-sm text-ink hover:bg-hover">
                <ArrowLeft className="h-4 w-4" /> Retour
              </Link>
              <Button variant="dark" onClick={downloadPdf}>
                <Download className="h-4 w-4" /> Télécharger PDF
              </Button>
              <Button onClick={() => window.print()}>
                <Printer className="h-4 w-4" /> Imprimer
              </Button>
            </div>
          }
        />
        {error && <Card className="mb-4 border-danger-line bg-danger-soft text-danger">{error}</Card>}
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : !doc || !company ? (
        /* Sans ce fallback, un document absent (ou une reponse arrivee apres
           le demontage) laissait une page entierement vide sans aucun message. */
        <Card className="mx-auto max-w-2xl text-center text-ink-3">
          {doc
            ? "Document introuvable ou supprime."
            : "Impossible de charger ce document. Rechargez la page."}
        </Card>
      ) : (
        <>
          <div className="flex justify-center overflow-x-auto pb-8">
            <div className="a4-sheet">
              {/* En-tête */}
              <div className="flex flex-wrap items-start justify-between gap-6 print-break-avoid">
                <div className="flex items-start gap-3">
                  <img src={company.logo || "/logo.png"} alt="logo" className="h-16 w-16 rounded-lg object-contain" />
                  <div>
                    <div className="text-xl font-bold text-ink">{company.name || "PaletteD&co"}</div>
                    <div className="mt-1 text-xs leading-relaxed text-ink-4">
                      {company.owner_name && <div>Gérant : {company.owner_name}</div>}
                      {company.address && <div>{company.address}</div>}
                      {company.email && <div>{company.email}</div>}
                      {company.phone && <div>{company.phone}</div>}
                      {company.siret && <div>SIRET : {company.siret}</div>}
                      {company.vat_number && <div>TVA intracom. : {company.vat_number}</div>}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className={`font-display text-3xl font-extrabold tracking-tight ${isQuote ? "text-accent" : isOrder ? "text-accent" : "text-brand-2"}`}>
                    {isQuote ? "DEVIS" : isOrder ? "BON DE COMMANDE" : "FACTURE"}
                  </div>
                  <div className="text-base font-semibold text-ink-3">{doc.number}</div>
                  <div className="mt-2 text-xs text-ink-4">
                    <div>Émis le {fmtDate(doc.issue_date)}</div>
                    {isQuote
                      ? <div>Valide jusqu'au {fmtDate((doc as Quote).valid_until)}</div>
                      : isOrder
                        ? <div>Livraison prévue le {fmtDate((doc as Order).valid_until)}</div>
                        : <div>Échue le {fmtDate((doc as Invoice).due_date)}</div>}
                  </div>
                </div>
              </div>

              <hr className="my-6 border-line-2 print-break-avoid" />

              {/* Client */}
              <div className="mb-6 print-break-avoid">
                <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">Client</div>
                <div className="mt-1 font-semibold text-ink-2">{client?.name || "—"}</div>
                <div className="text-xs leading-relaxed text-ink-4">
                  {client?.address && <div>{client.address}</div>}
                  {client?.email && <div>{client.email}</div>}
                  {client?.phone && <div>{client.phone}</div>}
                  {client?.siret && <div>SIRET : {client.siret}</div>}
                  {client?.vat_number && <div>TVA intracom. : {client.vat_number}</div>}
                </div>
              </div>

              {/* Tableau */}
              <div className="table-wrap print-break-avoid">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-surface-3 text-left text-[11px] uppercase tracking-wide text-ink">
                    <th className="rounded-l-lg px-3 py-2 font-medium">Désignation</th>
                    <th className="px-3 py-2 text-right font-medium">Qté</th>
                    <th className="px-3 py-2 text-right font-medium">Prix HT</th>
                    <th className="px-3 py-2 text-right font-medium">TVA</th>
                    <th className="rounded-r-lg px-3 py-2 text-right font-medium">Total HT</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.items.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="border-b border-line-2 px-3 py-6 text-center text-ink-3">
                        Aucune ligne
                      </td>
                    </tr>
                  ) : (
                    doc.items.map((it, i) =>
                      it.is_block ? (
                        <tr key={i} className="border-b border-line">
                          <td colSpan={5} className="px-3 py-2.5 text-sm">
                            <span
                              className={cn(
                                "block whitespace-pre-line",
                                it.align === "center" ? "text-center" : it.align === "right" ? "text-right" : "",
                                it.bold && "font-bold",
                                it.italic && "italic",
                                it.bold ? "text-ink" : "text-ink-3",
                              )}
                            >
                              {it.description || "—"}
                            </span>
                          </td>
                        </tr>
                      ) : (
                        <tr key={i} className="border-b border-line">
                          <td
                            className={cn(
                              "whitespace-pre-line px-3 py-2.5 text-sm text-ink-2",
                              it.align === "center" ? "text-center" : it.align === "right" ? "text-right" : "",
                              it.bold && "font-bold",
                              it.italic && "italic",
                            )}
                          >
                            {it.description || "—"}
                          </td>
                          <td className="px-3 py-2.5 text-right text-sm text-ink-4">{Number(it.quantity)}</td>
                          <td className="px-3 py-2.5 text-right text-sm text-ink-4">{fmt(it.unit_price)}</td>
                          <td className="px-3 py-2.5 text-right text-sm text-ink-4">{Number(it.tva_rate)} %</td>
                          <td className="px-3 py-2.5 text-right text-sm font-medium text-ink-2">
                            {fmt(money(round2(it.quantity) * round2(it.unit_price)))}
                          </td>
                        </tr>
                      ),
                    )
                  )}
                </tbody>
                </table>
              </div>

              {/* Totaux */}
              <div className="mt-4 flex justify-end print-break-avoid">
                <div className="w-full space-y-1 text-sm sm:w-64">
                  {byRate.map((r) => (
                    <div key={r.rate} className="flex justify-between">
                      <span className="text-ink-4">Base HT {r.rate}%</span>
                      <span className="font-medium text-ink-3">{fmt(r.base)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-line-2 pt-2">
                    <span className="text-ink-4">Total HT</span>
                    <span className="font-semibold text-ink-2">{fmt(doc.total_ht)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-4">TVA</span>
                    <span className="font-semibold text-ink-2">{fmt(doc.total_tva)}</span>
                  </div>
                  <div className="flex justify-between rounded-lg bg-surface-3 px-3 py-2 text-ink">
                    <span className="font-semibold">Total TTC</span>
                    <span className="text-base font-bold text-accent">{fmt(doc.total_ttc)}</span>
                  </div>
                  {overall && overall.paid > 0 && (
                    <div className="space-y-1 pt-1">
                      <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                        <div className="h-full rounded-full bg-success" style={{ width: `${overall.pct}%` }} />
                      </div>
                      <div className="flex justify-between text-ink-4">
                        <span>Payé</span>
                        <span className="font-semibold text-success">{fmt(overall.paid)}</span>
                      </div>
                      <div className="flex justify-between text-ink-4">
                        <span>Reste à payer</span>
                        <span className="font-semibold text-ink-2">{fmt(overall.remaining)}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Règlement */}
              {company.iban && (
                <div className="mt-6 border-t border-line-2 pt-3 text-xs text-ink-4 print-break-avoid">
                  <div className="font-semibold uppercase tracking-wide text-ink-3">Règlement</div>
                  <div className="mt-1">IBAN : {company.iban}{company.bic ? ` · BIC : ${company.bic}` : ""}</div>
                </div>
              )}

              {/* Conditions : en dessous du règlement */}
              <div className="mt-6 space-y-4 print-break-avoid">
                {doc.conditions && (
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Conditions de règlement</div>
                    <div className="whitespace-pre-line text-xs text-ink-4">{doc.conditions}</div>
                  </div>
                )}
                {doc.notes && (
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Notes</div>
                    <div className="whitespace-pre-line text-xs text-ink-4">{doc.notes}</div>
                  </div>
                )}
                {company.mentions && (
                  <div className="whitespace-pre-line text-[10px] leading-relaxed text-ink-3">{company.mentions}</div>
                )}
              </div>
            </div>
          </div>

          {/* Barre d'actions (non imprimée) */}
          <div className="no-print mx-auto mb-8 max-w-5xl">
            <Card className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {isQuote || isOrder ? (
                  <>
                    {["draft", "sent", "accepted", "declined"].map((s) => (
                      <Button
                        key={s}
                        variant={doc.status === s ? "primary" : "ghost"}
                        onClick={() => setStatus(s)}
                      >
                        {s === "accepted" ? "Accepter" : s === "sent" ? "Marquer envoyé" : s === "declined" ? "Refuser" : "Brouillon"}
                      </Button>
                    ))}
                    {doc.status === "accepted" && (
                      <div className="ml-auto flex items-center gap-2">
                        <input
                          className={inputCls + " w-40"}
                          placeholder="N° facture (vide = auto)"
                          value={invoiceNumber}
                          onChange={(e) => setInvoiceNumber(e.target.value)}
                        />
                        <Button onClick={convert} disabled={converting} className="bg-brand-2 text-brand-ink hover:brightness-95">
                          <FileText className="h-4 w-4" /> {converting ? "Conversion..." : "Convertir en facture"}
                        </Button>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {(["unpaid", "partial", "paid"] as const).map((s) => (
                      <Button key={s} variant={doc.status === s ? "primary" : "ghost"} onClick={() => setStatus(s)}>
                        {statusLabels[s]}
                      </Button>
                    ))}
                    <div className="ml-auto flex items-center gap-2">
                      <Badge className={statusColors[doc.status]}>{statusLabels[doc.status]}</Badge>
                      {isInvoice && !invoice?.finalized && (
                        <Button
                          variant="ghost"
                          className="text-danger"
                          onClick={removeInvoice}
                          title="Supprimer cette facture (elle n'est pas finalisée)"
                        >
                          <Trash2 className="h-4 w-4" /> Supprimer
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="flex flex-col gap-2 border-t border-line pt-3 sm:flex-row sm:flex-wrap sm:items-center">
                <input
                  className={inputCls + " sm:max-w-xs"}
                  type="email"
                  placeholder="E-mail du client"
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                />
                <Button variant="dark" onClick={sendMail} disabled={!emailTo.trim()}>
                  <Mail className="h-4 w-4" /> Envoyer par e-mail
                </Button>
                <Button variant="ghost" onClick={whatsApp}>
                  <MessageCircle className="h-4 w-4" /> WhatsApp
                </Button>
                <Button variant="ghost" onClick={copyPdfLink} title="Copier le lien public du PDF">
                  <Link2 className="h-4 w-4" /> Lien PDF
                </Button>
                <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-ink-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--accent)]"
                    checked={emailCopy}
                    onChange={(e) => setEmailCopy(e.target.checked)}
                  />
                  M'envoyer une copie
                </label>
                {isQuote && (
                  <Button variant="ghost" onClick={shareLink}>
                    <Share2 className="h-4 w-4" /> Lien de validation en ligne
                  </Button>
                )}
                {shareUrl && (
                  <div className="flex w-full items-stretch gap-2 sm:max-w-xl">
                    <input
                      readOnly
                      className={inputCls + " min-w-0 flex-1 text-xs"}
                      value={shareUrl}
                      onFocus={(e) => e.target.select()}
                    />
                    <Button variant="ghost" onClick={() => { navigator.clipboard?.writeText(shareUrl); setShareMsg("Lien récopié !"); }}>
                      <Link2 className="h-4 w-4" /> Copier
                    </Button>
                    <Button variant="ghost" onClick={shareWhatsApp}>
                      <MessageCircle className="h-4 w-4" /> WhatsApp
                    </Button>
                  </div>
                )}
                {(emailMsg || shareMsg || waMsg) && (
                  <div className="text-sm sm:w-full">
                    {emailMsg && (
                      <div className={emailMsg.ok ? "text-success" : "text-danger"}>{emailMsg.text}</div>
                    )}
                    {shareMsg && !emailMsg && <div className="break-all text-accent">{shareMsg}</div>}
                    {waMsg && !emailMsg && !shareMsg && <div className="break-all text-accent">{waMsg}</div>}
                  </div>
                )}
              </div>
            </Card>
            {(isQuote || isOrder) && doc.status === "invoiced" && (
              <div className="mt-3 text-sm text-ink-3">
                {isQuote ? "Ce devis" : "Ce bon de commande"} a été converti en facture.{" "}
                <Link to="/invoices" className="text-accent underline">Voir les factures</Link>
              </div>
            )}

            {isInvoice && invoice && (
              <Card className="mt-3">
                <h2 className="mb-3 font-semibold text-ink">Paiements reçus</h2>
                <div className="mb-3 flex items-end justify-between gap-2">
                  <div>
                    <div className="text-2xl font-semibold text-success">{fmt(overall?.paid ?? 0)}</div>
                    <div className="text-xs text-ink-4">payés sur {fmt(invoice.total_ttc)}</div>
                  </div>
                  <Badge className={statusColors[invoice.status]}>{statusLabels[invoice.status]}</Badge>
                </div>
                {(invoice.payments || []).length === 0 ? (
                  <p className="text-sm text-ink-4">Aucun paiement enregistré pour cette facture.</p>
                ) : (
                  <div className="divide-y divide-line">
                    {(invoice.payments || []).map((p: Payment) => (
                      <div key={p.id} className="flex items-center justify-between gap-3 py-2">
                        <div>
                          <div className="font-medium text-ink">{fmt(p.amount)}</div>
                          <div className="text-xs text-ink-4">
                            {fmtDate(p.date)} · {p.method}
                            {p.note ? ` · ${p.note}` : ""}
                          </div>
                        </div>
                        <Button variant="ghost" className="p-2" onClick={() => removePayment(p.id)}>
                          <Trash2 className="h-4 w-4 text-danger" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-4 grid gap-2 sm:grid-cols-[110px_1fr_1fr]">
                  <Field label="Montant €">
                    <input
                      type="number" min="0" step="0.01" className={inputCls}
                      value={payForm.amount}
                      onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                      placeholder="0,00"
                    />
                  </Field>
                  <Field label="Date">
                    <input type="date" className={inputCls} value={payForm.date} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })} />
                  </Field>
                  <Field label="Moyen">
                    <select className={inputCls} value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}>
                      <option>Virement</option>
                      <option>Chèque</option>
                      <option>Espèces</option>
                      <option>Carte bancaire</option>
                      <option>Autre</option>
                    </select>
                  </Field>
                </div>
                <div className="mt-2 flex items-end gap-2">
                  <Field label="Note" className="flex-1">
                    <input className={inputCls} value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} placeholder="Acompte, avantage..." />
                  </Field>
                  <Button onClick={addPayment} disabled={!Number(payForm.amount) || Number(payForm.amount) <= 0}>
                    <Plus className="h-4 w-4" /> Ajouter
                  </Button>
                </div>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}