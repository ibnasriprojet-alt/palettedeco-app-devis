import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, statusColors, statusLabels } from "../lib/api";
import type { Client, ClientHistory } from "../lib/types";
import { Badge, Button, Card, EmptyState, LinkButton, Modal, PageHeader, Spinner } from "../components/ui";
import { fmt, fmtDate } from "../lib/format";
import { History, Pencil, Search, Trash2, UserPlus, Users } from "lucide-react";

export default function Clients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [histClient, setHistClient] = useState<Client | null>(null);
  const [hist, setHist] = useState<ClientHistory | null>(null);
  const [histLoading, setHistLoading] = useState(false);

  function load() {
    setLoading(true);
    api
      .getClients()
      .then(setClients)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const filtered = clients.filter(
    (c) =>
      c.name.toLowerCase().includes(query.toLowerCase()) ||
      c.email.toLowerCase().includes(query.toLowerCase()),
  );

  async function remove(c: Client) {
    if (!confirm(`Supprimer le client « ${c.name} » ?`)) return;
    try {
      await api.deleteClient(c.id);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function showHistory(c: Client) {
    setHistClient(c);
    setHist(null);
    setHistLoading(true);
    try {
      setHist(await api.getClientHistory(c.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setHistLoading(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Clients"
        subtitle="Votre répertoire clients"
        action={<LinkButton to="/clients/new"><UserPlus className="h-4 w-4" /> Nouveau client</LinkButton>}
      />

      <div className="relative mb-4">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-stone-500" />
        <input
          className="w-full rounded-lg border border-white/15 bg-[#271a10] py-2 pl-9 pr-3 text-sm text-stone-100 placeholder-stone-500"
          placeholder="Rechercher par nom ou e-mail..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : error ? (
        <Card className="text-red-300">{error}</Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Users className="h-8 w-8" />}
          title="Aucun client"
          text="Ajoutez vos clients pour remplir vos devis en un clic."
          action={<LinkButton to="/clients/new"><UserPlus className="h-4 w-4" /> Ajouter un client</LinkButton>}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#251710] p-4">
              <div className="min-w-0">
                <div className="font-semibold text-white">{c.name}</div>
                <div className="truncate text-sm text-stone-400">
                  {[c.email, c.phone, c.address].filter(Boolean).join(" · ") || "Aucune coordonnée"}
                </div>
                {c.vat_number && <div className="text-xs text-stone-500">TVA : {c.vat_number}</div>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button onClick={() => showHistory(c)} className="rounded-lg p-2 text-stone-400 hover:bg-white/10 hover:text-white" title="Historique">
                  <History className="h-4 w-4" />
                </button>
                <Link to={`/clients/${c.id}`} className="rounded-lg p-2 text-stone-400 hover:bg-white/10 hover:text-white">
                  <Pencil className="h-4 w-4" />
                </Link>
                <Button variant="ghost" className="p-2" onClick={() => remove(c)}>
                  <Trash2 className="h-4 w-4 text-red-400" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!histClient} onClose={() => setHistClient(null)} title={`Historique · ${histClient?.name || ""}`}>
        {histLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : hist ? (
          <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">Devis ({hist.quotes.length})</h4>
              {hist.quotes.length === 0 ? (
                <p className="text-sm text-stone-500">Aucun devis.</p>
              ) : (
                <div className="space-y-1.5">
                  {hist.quotes.map((q) => (
                    <Link key={q.id} to={`/quotes/${q.id}/view`} onClick={() => setHistClient(null)} className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm hover:bg-white/10">
                      <div>
                        <div className="font-medium text-stone-100">{q.number}</div>
                        <div className="text-xs text-stone-500">Émis le {fmtDate(q.issue_date)}{q.valid_until && ` · valable jusqu'au ${fmtDate(q.valid_until)}`}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="font-medium text-white">{fmt(q.total_ttc)}</span>
                        <Badge className={statusColors[q.status]}>{statusLabels[q.status]}</Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">Factures ({hist.invoices.length})</h4>
              {hist.invoices.length === 0 ? (
                <p className="text-sm text-stone-500">Aucune facture.</p>
              ) : (
                <div className="space-y-1.5">
                  {hist.invoices.map((i) => (
                    <Link key={i.id} to={`/invoices/${i.id}`} onClick={() => setHistClient(null)} className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm hover:bg-white/10">
                      <div>
                        <div className="font-medium text-stone-100">{i.number}</div>
                        <div className="text-xs text-stone-500">Émise le {fmtDate(i.issue_date)}{i.due_date && ` · échéance ${fmtDate(i.due_date)}`}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="font-medium text-white">{fmt(i.total_ttc)}</span>
                        <Badge className={statusColors[i.status]}>{statusLabels[i.status]}</Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}