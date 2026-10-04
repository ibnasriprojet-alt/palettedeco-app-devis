import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, statusColors, statusLabels } from "../lib/api";
import type { DocRow, Invoice, Quote, Stats as StatsType } from "../lib/types";
import { fmt, fmtDate } from "../lib/format";
import { Badge, Button, Card, EmptyState, LinkButton, PageHeader, Spinner } from "../components/ui";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, FilePlus2, Files, HandCoins, ReceiptText, Send, TrendingUp, UserPlus, Users } from "lucide-react";

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

      {loading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : error ? (
        <Card className="text-red-300">{error}</Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Link to="/quotes">
              <Card className="transition hover:border-[#14b8a6]/50">
                <div className="flex items-center gap-2 text-stone-400"><Files className="h-5 w-5" /><span className="text-sm">Devis</span></div>
                <div className="mt-2 text-lg font-semibold text-white">{Number(stats?.quotes ?? 0)} <span className="text-sm font-normal text-stone-500">· {fmt(stats?.accepted_value ?? 0)} acceptés</span></div>
              </Card>
            </Link>
            <Link to="/invoices">
              <Card className="transition hover:border-[#14b8a6]/50">
                <div className="flex items-center gap-2 text-stone-400"><ReceiptText className="h-5 w-5" /><span className="text-sm">Factures</span></div>
                <div className="mt-2 text-lg font-semibold text-white">{Number(stats?.invoices ?? 0)}</div>
              </Card>
            </Link>
            <Link to="/invoices">
              <Card className="transition hover:border-[#14b8a6]/50">
                <div className="flex items-center gap-2 text-stone-400"><HandCoins className="h-5 w-5" /><span className="text-sm">Encaissé</span></div>
                <div className="mt-2 text-lg font-semibold text-emerald-300">{fmt(stats?.received_total ?? 0)}</div>
              </Card>
            </Link>
            <Link to="/invoices">
              <Card className="transition hover:border-[#14b8a6]/50">
                <div className="flex items-center gap-2 text-stone-400"><Clock className="h-5 w-5" /><span className="text-sm">À encaisser</span></div>
                <div className="mt-2 text-lg font-semibold text-amber-300">{fmt(stats?.pending_total ?? 0)}</div>
              </Card>
            </Link>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-3">
            <Card className="!p-3">
              <div className="flex items-center gap-2 text-xs text-stone-400"><TrendingUp className="h-4 w-4" /> Encaissé ce mois</div>
              <div className="mt-1 text-base font-semibold text-white">{fmt(stats?.month_invoiced ?? 0)}</div>
              <div className="text-xs text-stone-500">{Number(stats?.month_count ?? 0)} facture(s)</div>
            </Card>
            <Card className="!p-3">
              <div className="flex items-center gap-2 text-xs text-stone-400"><CheckCircle2 className="h-4 w-4" /> Devis acceptés</div>
              <div className="mt-1 text-base font-semibold text-white">{fmt(stats?.accepted_value ?? 0)}</div>
              <div className="text-xs text-stone-500">Taux : {Math.round(Number(stats?.acceptance_rate ?? 0))}%</div>
            </Card>
            <Card className="!p-3">
              <div className="flex items-center gap-2 text-xs text-stone-400"><Users className="h-4 w-4" /> Clients</div>
              <div className="mt-1 text-base font-semibold text-white">{Number(stats?.clients ?? 0)}</div>
              <div className="text-xs text-stone-500">sociétés enregistrées</div>
            </Card>
          </div>

          {relances.length > 0 && (
            <Card className="mt-4 border-amber-500/30">
              <h2 className="mb-1 flex items-center justify-between font-semibold text-white">
                <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-300" /> À relancer</span>
                <Link to="/invoices" className="text-sm font-normal text-[#14b8a6] hover:underline">Voir les factures</Link>
              </h2>
              <div className="mt-2 divide-y divide-white/5">
                {relances.map((r) => {
                  const key = `${r.kind}-${r.id}`;
                  const busy = relancing[key];
                  const done = relanced[key];
                  return (
                    <div key={key} className="flex items-center gap-2 py-2">
                      <Link to={r.kind === "invoice" ? `/invoices/${r.id}` : `/quotes/${r.id}/view`} className="flex min-w-0 flex-1 items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 font-medium text-stone-100">
                            {r.number}
                            {r.kind === "invoice" ? (
                              <Badge className="bg-red-500/15 text-red-300 border-red-500/40">En retard</Badge>
                            ) : (
                              <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/40">Expire bientôt</Badge>
                            )}
                          </div>
                          <div className="truncate text-sm text-stone-400">{r.client || "Client : —"}</div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-0.5">
                          <span className="text-sm font-semibold text-white">{fmt(r.total_ttc)}</span>
                          <span className="text-xs text-stone-500">{r.kind === "invoice" ? `Échue le ${fmtDate(r.due_date)}` : `Valable jusqu'au ${fmtDate(r.valid_until)}`}</span>
                        </div>
                      </Link>
                      <Button variant="ghost" className="shrink-0 px-3 py-1.5 text-xs" disabled={busy} onClick={() => relance(r)}>
                        {done ? <span className="text-emerald-300">Relancé</span> : <><Send className="h-3.5 w-3.5" /> {busy ? "..." : "Relancer"}</>}
                      </Button>
                    </div>
                  );
                })}
              </div>
              {relanceErr && <div className="mt-2 text-sm text-red-300">{relanceErr}</div>}
            </Card>
          )}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="mb-3 flex items-center justify-between font-semibold text-white">
                Devis récents
                <Link to="/quotes" className="flex items-center text-sm font-normal text-[#14b8a6] hover:underline">Tout voir <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
              </h2>
              {quotes.length === 0 ? (
                <EmptyState
                  title="Aucun devis"
                  text="Créez votre premier devis en un clic."
                  action={<LinkButton to="/quotes/new"><FilePlus2 className="h-4 w-4" /> Créer un devis</LinkButton>}
                />
              ) : (
                <div className="divide-y divide-white/5">
                  {quotes.map((q) => (
                    <Link key={q.id} to={`/quotes/${q.id}`} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <div className="font-medium text-stone-100">{q.number}</div>
                        <div className="truncate text-sm text-stone-400">{q.client?.name || "Client : —"}</div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="text-sm font-semibold text-white">{fmt(q.total_ttc)}</span>
                        <Badge className={statusColors[q.status]}>{statusLabels[q.status]}</Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </Card>

            <Card>
              <h2 className="mb-3 flex items-center justify-between font-semibold text-white">
                Factures récentes
                <Link to="/invoices" className="flex items-center text-sm font-normal text-[#14b8a6] hover:underline">Tout voir <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
              </h2>
              {invoices.length === 0 ? (
                <EmptyState title="Aucune facture" text="Les factures sont créées à partir de vos devis acceptés." />
              ) : (
                <div className="divide-y divide-white/5">
                  {invoices.map((i) => {
                    const remaining = Number(i.total_ttc) - Number(i.paid ?? 0);
                    const pct = Math.min(100, Math.round((Number(i.paid ?? 0) / Number(i.total_ttc)) * 100));
                    return (
                      <Link key={i.id} to={`/invoices/${i.id}`} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <div className="font-medium text-stone-100">{i.number}</div>
                          <div className="truncate text-sm text-stone-400">{i.client?.name || "Client : —"}</div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-white">{fmt(i.total_ttc)}</span>
                            <Badge className={statusColors[i.status]}>{statusLabels[i.status]}</Badge>
                          </div>
                          {i.status === "partial" && (
                            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/10">
                              <div className="h-full rounded-full bg-[#14b8a6]" style={{ width: `${pct}%` }} />
                            </div>
                          )}
                          {i.status === "partial" && (
                            <span className="text-xs text-stone-500">reste {fmt(remaining)}</span>
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
              <h2 className="mb-3 font-semibold text-white">Statuts des devis</h2>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
                {quoteStatuses.map((s) => (
                  <div key={s}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="text-stone-300">{statusLabels[s]}</span>
                      <span className="font-medium text-white">{Number(stats?.[s as keyof StatsType]) || 0}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full" style={{
                        width: `${Math.min(100, ((Number(stats?.[s as keyof StatsType]) || 0) / Math.max(1, Number(stats?.quotes) || 1)) * 100)}%`,
                        background: "#14b8a6",
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <h2 className="mb-3 font-semibold text-white">Encaissements</h2>
              <div className="space-y-3">
                <div className="flex justify-between text-sm"><span className="text-stone-400">Total facturé</span><span className="font-medium text-white">{fmt(stats?.invoices_total ?? 0)}</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-emerald-400" style={{ width: `${Math.min(100, ((Number(stats?.received_total ?? 0) || 0) / Math.max(1, Number(stats?.invoices_total ?? 0) || 1)) * 100)}%` }} />
                </div>
                <div className="flex justify-between text-sm"><span className="text-stone-400">Encaissé</span><span className="font-medium text-emerald-300">{fmt(stats?.received_total ?? 0)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-stone-400">Restant dû</span><span className="font-medium text-amber-300">{fmt(stats?.pending_total ?? 0)}</span></div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-white/5 p-2"><div className="text-base font-semibold text-white">{Number(stats?.paid ?? 0)}</div><div className="text-xs text-stone-500">{statusLabels.paid}</div></div>
                  <div className="rounded-lg bg-white/5 p-2"><div className="text-base font-semibold text-white">{Number(stats?.partial ?? 0)}</div><div className="text-xs text-stone-500">{statusLabels.partial}</div></div>
                  <div className="rounded-lg bg-white/5 p-2"><div className="text-base font-semibold text-white">{Number(stats?.unpaid ?? 0)}</div><div className="text-xs text-stone-500">{statusLabels.unpaid}</div></div>
                </div>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}