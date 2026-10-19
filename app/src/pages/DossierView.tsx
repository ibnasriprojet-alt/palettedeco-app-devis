import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, statusColors, statusLabels } from "../lib/api";
import type { QuoteGroup } from "../lib/types";
import { fmt, fmtDate } from "../lib/format";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Spinner } from "../components/ui";
import { ArrowLeft, CheckCircle2, Folder, Pencil, ReceiptText, FileText } from "lucide-react";
import { cn } from "../lib/cn";

export default function DossierView() {
  const gid = Number(useParams().id);
  const [group, setGroup] = useState<QuoteGroup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload() {
    setError("");
    setGroup(await api.getQuoteGroup(gid));
  }

  useEffect(() => {
    setLoading(true);
    reload()
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gid]);

  async function choose(quoteId: number) {
    if (busy) return;
    if (!confirm("Confirmer : le client a choisi ce devis ?\nLes autres variantes du dossier passeront en « refusé ».")) return;
    setBusy(true);
    setError("");
    try {
      await api.chooseQuoteInGroup(gid, quoteId);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (error && !group) return <Card className="text-danger">{error}</Card>;
  if (!group) return <Card className="text-ink-3">Dossier introuvable.</Card>;

  const quotes = group.quotes || [];
  const invoices = group.invoices || [];
  const totalQuotes = quotes.reduce((s, q) => s + Number(q.total_ttc), 0);
  const totalInvoices = invoices.reduce((s, i) => s + Number(i.total_ttc), 0);

  return (
    <div>
      <PageHeader
        title={group.name}
        subtitle={group.client?.name ? `Dossier · ${group.client.name}` : "Dossier"}
        action={<LinkButton to="/quotes"><ArrowLeft className="h-4 w-4" /> Retour aux devis</LinkButton>}
      />

      {error && <Card className="mb-4 text-danger">{error}</Card>}

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge
          className={
            group.status === "chosen"
              ? "bg-success-soft text-success border-success-line"
              : "bg-surface-3 text-ink-2 border-line-2"
          }
        >
          {group.status === "chosen" ? "Dossier choisi" : "Dossier ouvert"}
        </Badge>
        <span className="text-sm text-ink-3">
          {quotes.length} devis · {fmt(totalQuotes)} — {invoices.length} facture{invoices.length > 1 ? "s" : ""} · {fmt(totalInvoices)}
        </span>
      </div>

      <section className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-ink-3">
          <FileText className="h-4 w-4" /> Devis {quotes.length > 0 && <span className="text-ink-4">({quotes.length})</span>}
        </h2>
        {quotes.length === 0 ? (
          <Card className="text-sm text-ink-3">Aucun devis dans ce dossier.</Card>
        ) : (
          <div className="space-y-2">
            {quotes.map((q) => {
              const chosen = group.chosen_quote_id === q.id;
              const canChoose = group.status === "open" && q.status !== "declined" && q.status !== "invoiced";
              return (
                <div
                  key={q.id}
                  className={cn(
                    "flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-surface p-4",
                    chosen ? "border-success-line" : "border-line",
                  )}
                >
                  <Link to={`/quotes/${q.id}/view`} className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 font-semibold text-ink">
                      {q.number}
                      {chosen && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success">
                          <CheckCircle2 className="h-3 w-3" /> Choix client
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-ink-4">Émis le {fmtDate(q.issue_date)} · valide jusqu'au {fmtDate(q.valid_until)}</div>
                  </Link>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className="font-semibold text-ink">{fmt(q.total_ttc)}</span>
                    <Badge className={statusColors[q.status]}>{statusLabels[q.status]}</Badge>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {canChoose && (
                      <button
                        onClick={() => choose(q.id)}
                        disabled={busy}
                        className="flex items-center gap-1.5 rounded-lg border border-success-line bg-success-soft px-3 py-1.5 text-xs font-medium text-success transition hover:brightness-95 disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Le client a choisi
                      </button>
                    )}
                    <Link
                      to={`/quotes/${q.id}`}
                      className="flex items-center gap-1.5 rounded-lg border border-line-2 px-3 py-1.5 text-xs font-medium text-ink-2 transition hover:bg-hover"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Modifier
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-ink-3">
          <ReceiptText className="h-4 w-4" /> Factures {invoices.length > 0 && <span className="text-ink-4">({invoices.length})</span>}
        </h2>
        {invoices.length === 0 ? (
          <Card className="text-sm text-ink-3">Aucune facture dans ce dossier.</Card>
        ) : (
          <div className="space-y-2">
            {invoices.map((inv) => (
              <Link
                key={inv.id}
                to={`/invoices/${inv.id}`}
                className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 transition hover:border-accent/40"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-ink">{inv.number}</div>
                  <div className="mt-1 text-xs text-ink-4">
                    {inv.quote_number ? `Devis ${inv.quote_number} · ` : ""}Émise le {fmtDate(inv.issue_date)}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <span className="font-semibold text-ink">{fmt(inv.total_ttc)}</span>
                  <Badge className={statusColors[inv.status]}>{statusLabels[inv.status]}</Badge>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {quotes.length === 0 && invoices.length === 0 && (
        <EmptyState icon={<Folder className="h-8 w-8" />} title="Dossier vide" text="Rattachez des devis ou des factures à ce dossier." />
      )}
    </div>
  );
}
