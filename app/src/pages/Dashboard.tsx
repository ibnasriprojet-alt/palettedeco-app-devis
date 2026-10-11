import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, statusColors, statusLabels } from "../lib/api";
import type { DocRow, Invoice, Quote, Stats as StatsType } from "../lib/types";
import { fmt, fmtDate } from "../lib/format";
import { Badge, Button, Card, EmptyState, LinkButton, PageHeader, Spinner } from "../components/ui";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, FilePlus2, Files, HandCoins, ReceiptText, Send, TrendingUp, UserPlus, Users } from "lucide-react";
import { KpiBand } from "../components/KpiBand";

export default function Dashboard() {
  const [stats, setStats] = useState<StatsType | null>(null);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [relancing, setRelancing] = useState<Record<string, boolean>>({});
  const [relanced, setRelanced] = useState<Record<string, boolean>>({});
  const [relanceErr, setRelanceErr] = useState("");

  async function relance(r: DocRow & { kind: "quote" | "invoice" }) {
    const key = `${r.kind}-${r.id}`;
    setRelanceErr("");
    setRelancing((p) => ({ ...p, [key]: true }));
    try {
      await api.sendDocument(r.kind as "quote" | "invoice", r.id, "");
      setRelanced((p) => ({ ...p, [key]: true }));
    } catch (e) {
      setRelanceErr((e as Error).message);
    } finally {
      setRelancing((p) => ({ ...p, [key]: false }));
    }
  }

  useEffect(() => {
    Promise.all([api.getStats(), api.getQuotes(), api.getInvoices()])
      .then(([s, q, i]) => {
        setStats(s);
        setQuotes(q.slice(0, 5));
        setInvoices(i.slice(0, 5));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const overdue = stats?.overdue ?? [];
  const expiring = stats?.expiring_quotes ?? [];
  /* Encaissement reel = somme des reglements enregistres. Les compteurs par statut
     (received_total / pending_total) ignorent les acomptes des factures "partial"
     et donnaient donc un chiffre faux des le premier acompte. */
  const collected = Math.max(0, Number(stats?.payments_total_total ?? 0) || 0);
  const outstanding = Math.max(0, (Number(stats?.invoices_total ?? 0) || 0) - collected);
  const relances: Array<DocRow & { kind: "quote" | "invoice" }> = [
    ...overdue.map((r) => ({ ...r, kind: "invoice" as const })),
    ...expiring.map((r) => ({ ...r, kind: "quote" as const })),
  ]
    .sort((a, b) => String(a.due_date || a.valid_until || "").localeCompare(String(b.due_date || b.valid_until || "")))
    .slice(0, 6);

  const quoteStatuses = ["draft", "sent", "accepted", "declined", "invoiced"];

  return (
    <div>
      <PageHeader
        title="Tableau de bord"
        subtitle="Suivi de vos devis, factures et encaissements"
        action={
          <div className="flex gap-2">
            <LinkButton to="/quotes/new">
              <FilePlus2 className="h-4 w-4" /> Nouveau devis
            </LinkButton>
            <LinkButton to="/clients/new" variant="dark">
              <UserPlus className="h-4 w-4" />
            </LinkButton>
          </div>
        }
      />

      {/* Indicateurs du cockpit, pilotes par le selecteur de periode */}
      <KpiBand />

      {loading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : error ? (
        <Card className="text-danger">{error}</Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Link to="/quotes" className="group">
              <Card className="transition hover:border-accent/50 hover:bg-surface-2">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent"><Files className="h-4 w-4" /></span>
                  <span className="text-sm text-ink-3">Devis</span>
                </div>
                <div className="mt-2.5 text-lg font-semibold tabular-nums text-ink">{Number(stats?.quotes ?? 0)} <span className="text-sm font-normal text-ink-4">· {fmt(stats?.accepted_value ?? 0)} acceptés</span></div>
              </Card>
            </Link>
            <Link to="/invoices" className="group">
              <Card className="transition hover:border-accent/50 hover:bg-surface-2">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent"><ReceiptText className="h-4 w-4" /></span>
                  <span className="text-sm text-ink-3">Factures</span>
                </div>
                <div className="mt-2.5 text-lg font-semibold tabular-nums text-ink">{Number(stats?.invoices ?? 0)}</div>
              </Card>
            </Link>
            <Link to="/invoices" className="group">
              <Card className="transition hover:border-accent/50 hover:bg-surface-2">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-success-soft text-success"><HandCoins className="h-4 w-4" /></span>
                  <span className="text-sm text-ink-3">Encaissé</span>
                </div>
                <div className="mt-2.5 text-lg font-semibold tabular-nums text-success">{fmt(collected)}</div>
              </Card>
            </Link>
            <Link to="/invoices" className="group">
              <Card className="transition hover:border-accent/50 hover:bg-surface-2">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-2"><Clock className="h-4 w-4" /></span>
                  <span className="text-sm text-ink-3">À encaisser</span>
                </div>
                <div className="mt-2.5 text-lg font-semibold tabular-nums text-brand-2">{fmt(outstanding)}</div>
              </Card>
            </Link>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-3">
            <Card className="p-3">
              <div className="flex items-center gap-2 text-xs text-ink-3"><TrendingUp className="h-4 w-4" /> Facturé ce mois</div>
              <div className="mt-1 text-base font-semibold text-ink">{fmt(stats?.month_invoiced ?? 0)}</div>
              <div className="text-xs text-ink-4">{Number(stats?.month_count ?? 0)} facture(s)</div>
            </Card>
            <Card className="p-3">
              <div className="flex items-center gap-2 text-xs text-ink-3"><CheckCircle2 className="h-4 w-4" /> Devis acceptés</div>
              <div className="mt-1 text-base font-semibold text-ink">{fmt(stats?.accepted_value ?? 0)}</div>
              <div className="text-xs text-ink-4">Taux : {Math.round(Number(stats?.acceptance_rate ?? 0))}%</div>
            </Card>
            <Card className="p-3">
              <div className="flex items-center gap-2 text-xs text-ink-3"><Users className="h-4 w-4" /> Clients</div>
              <div className="mt-1 text-base font-semibold text-ink">{Number(stats?.clients ?? 0)}</div>
              <div className="text-xs text-ink-4">sociétés enregistrées</div>
            </Card>
          </div>

          {relances.length > 0 && (
            <Card className="mt-4 border-brand-line">
              <h2 className="mb-1 flex items-center justify-between font-display text-lg font-semibold text-ink">
                <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-brand-2" /> À relancer</span>
                <Link to="/invoices" className="text-sm font-normal text-accent hover:underline">Voir les factures</Link>
              </h2>
              <div className="mt-2 divide-y divide-line">
                {relances.map((r) => {
                  const key = `${r.kind}-${r.id}`;
                  const busy = relancing[key];
                  const done = relanced[key];
                  return (
                    <div key={key} className="flex items-center gap-2 py-2">
                      <Link to={r.kind === "invoice" ? `/invoices/${r.id}` : `/quotes/${r.id}/view`} className="flex min-w-0 flex-1 items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 font-medium text-ink">
                            {r.number}
                            {r.kind === "invoice" ? (
                              <Badge className="bg-danger-soft text-danger border-danger-line">En retard</Badge>
                            ) : (
                              <Badge className="bg-brand-soft text-brand-2 border-brand-line">Expire bientôt</Badge>
                            )}
                          </div>
                          <div className="truncate text-sm text-ink-3">{r.client || "Client : —"}</div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-0.5">
                          <span className="text-sm font-semibold text-ink">{fmt(r.total_ttc)}</span>
                          <span className="text-xs text-ink-4">{r.kind === "invoice" ? `Échue le ${fmtDate(r.due_date)}` : `Valable jusqu'au ${fmtDate(r.valid_until)}`}</span>
                        </div>
                      </Link>
                      <Button variant="ghost" className="shrink-0 px-3 py-1.5 text-xs" disabled={busy} onClick={() => relance(r)}>
                        {done ? <span className="text-success">Relancé</span> : <><Send className="h-3.5 w-3.5" /> {busy ? "..." : "Relancer"}</>}
                      </Button>
                    </div>
                  );
                })}
              </div>
              {relanceErr && <div className="mt-2 text-sm text-danger">{relanceErr}</div>}
            </Card>
          )}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="mb-3 flex items-center justify-between font-display text-lg font-semibold text-ink">
                Devis récents
                <Link to="/quotes" className="flex items-center text-sm font-normal text-accent hover:underline">Tout voir <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
              </h2>
              {quotes.length === 0 ? (
                <EmptyState
                  title="Aucun devis"
                  text="Créez votre premier devis en un clic."
                  action={<LinkButton to="/quotes/new"><FilePlus2 className="h-4 w-4" /> Créer un devis</LinkButton>}
                />
              ) : (
                <div className="divide-y divide-line">
                  {quotes.map((q) => (
                    <Link key={q.id} to={`/quotes/${q.id}`} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <div className="font-medium text-ink">{q.number}</div>
                        <div className="truncate text-sm text-ink-3">{q.client?.name || "Client : —"}</div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="text-sm font-semibold text-ink">{fmt(q.total_ttc)}</span>
                        <Badge className={statusColors[q.status]}>{statusLabels[q.status]}</Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </Card>

            <Card>
              <h2 className="mb-3 flex items-center justify-between font-display text-lg font-semibold text-ink">
                Factures récentes
                <Link to="/invoices" className="flex items-center text-sm font-normal text-accent hover:underline">Tout voir <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
              </h2>
              {invoices.length === 0 ? (
                <EmptyState title="Aucune facture" text="Les factures sont créées à partir de vos devis acceptés." />
              ) : (
                <div className="divide-y divide-line">
                  {invoices.map((i) => {
                    const remaining = Number(i.total_ttc) - Number(i.paid ?? 0);
                    const pct = Math.min(100, Math.round((Number(i.paid ?? 0) / Math.max(1, Number(i.total_ttc))) * 100));
                    return (
                      <Link key={i.id} to={`/invoices/${i.id}`} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <div className="font-medium text-ink">{i.number}</div>
                          <div className="truncate text-sm text-ink-3">{i.client?.name || "Client : —"}</div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-ink">{fmt(i.total_ttc)}</span>
                            <Badge className={statusColors[i.status]}>{statusLabels[i.status]}</Badge>
                          </div>
                          {i.status === "partial" && (
                            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-hover">
                              <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                            </div>
                          )}
                          {i.status === "partial" && (
                            <span className="text-xs text-ink-4">reste {fmt(remaining)}</span>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="mb-3 font-display text-lg font-semibold text-ink">Statuts des devis</h2>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
                {quoteStatuses.map((s) => (
                  <div key={s}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="text-ink-2">{statusLabels[s]}</span>
                      <span className="font-medium text-ink">{Number(stats?.[s as keyof StatsType]) || 0}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-hover">
                      <div className="h-full rounded-full" style={{
                        width: `${Math.min(100, ((Number(stats?.[s as keyof StatsType]) || 0) / Math.max(1, Number(stats?.quotes) || 1)) * 100)}%`,
                        background: "var(--accent)",
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <h2 className="mb-3 font-display text-lg font-semibold text-ink">Encaissements</h2>
              <div className="space-y-3">
                <div className="flex justify-between text-sm"><span className="text-ink-3">Total facturé</span><span className="font-medium text-ink">{fmt(stats?.invoices_total ?? 0)}</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-hover">
                  <div className="h-full rounded-full bg-success" style={{ width: `${Math.min(100, (collected / Math.max(1, Number(stats?.invoices_total ?? 0) || 1)) * 100)}%` }} />
                </div>
                <div className="flex justify-between text-sm"><span className="text-ink-3">Encaissé</span><span className="font-medium text-success">{fmt(collected)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-ink-3">Restant dû</span><span className="font-medium text-brand-2">{fmt(outstanding)}</span></div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-subtle p-2"><div className="text-base font-semibold text-ink">{Number(stats?.paid ?? 0)}</div><div className="text-xs text-ink-4">{statusLabels.paid}</div></div>
                  <div className="rounded-lg bg-subtle p-2"><div className="text-base font-semibold text-ink">{Number(stats?.partial ?? 0)}</div><div className="text-xs text-ink-4">{statusLabels.partial}</div></div>
                  <div className="rounded-lg bg-subtle p-2"><div className="text-base font-semibold text-ink">{Number(stats?.unpaid ?? 0)}</div><div className="text-xs text-ink-4">{statusLabels.unpaid}</div></div>
                </div>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}