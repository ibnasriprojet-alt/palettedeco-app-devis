import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, statusColors, statusLabels } from "../lib/api";
import type { Invoice } from "../lib/types";
import { fmt, fmtDate } from "../lib/format";
import { Badge, Card, EmptyState, PageHeader, Spinner, inputCls } from "../components/ui";
import { ReceiptText, Search, SearchX } from "lucide-react";
import { cn } from "../lib/cn";

export default function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .getInvoices()
      .then(setInvoices)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = invoices;
    if (q) {
      arr = arr.filter(
        (d) =>
          (d.number || "").toLowerCase().includes(q) ||
          (d.client?.name || "").toLowerCase().includes(q) ||
          (d.client?.email || "").toLowerCase().includes(q) ||
          (d.quote?.number || "").toLowerCase().includes(q),
      );
    }
    return [...arr].sort((a, b) => {
      if (sort === "amount-desc") return Number(b.total_ttc) - Number(a.total_ttc);
      if (sort === "amount-asc") return Number(a.total_ttc) - Number(b.total_ttc);
      if (sort === "oldest") return String(a.issue_date).localeCompare(String(b.issue_date)) || a.id - b.id;
      return String(b.issue_date).localeCompare(String(a.issue_date)) || b.id - a.id;
    });
  }, [invoices, query, sort]);

  return (
    <div>
      <PageHeader title="Factures" subtitle={`${filtered.length} factures`} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" />
          <input
            className={cn(inputCls, "pl-9")}
            placeholder="Rechercher (numéro, client…)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select className={cn(inputCls, "w-full sm:w-48")} value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="recent">Plus récentes</option>
          <option value="oldest">Plus anciennes</option>
          <option value="amount-desc">Montant décroissant</option>
          <option value="amount-asc">Montant croissant</option>
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : error ? (
        <Card className="text-red-300">{error}</Card>
      ) : invoices.length === 0 ? (
        <EmptyState
          icon={<ReceiptText className="h-8 w-8" />}
          title="Aucune facture"
          text="Les factures sont créées automatiquement depuis un devis accepté."
        />
      ) : filtered.length === 0 ? (
        <Card className="flex items-center gap-3 text-stone-400">
          <SearchX className="h-5 w-5" /> Aucune facture ne correspond à votre recherche.
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((inv) => (
            <Link
              key={inv.id}
              to={`/invoices/${inv.id}`}
              className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#251710] p-4 transition hover:border-[#14b8a6]/40"
            >
              <div className="min-w-0">
                <div className="font-semibold text-white">{inv.number}</div>
                <div className="truncate text-sm text-stone-400">
                  {inv.quote?.number ? <span className="text-stone-500">{inv.quote.number} · </span> : null}
                  {inv.client?.name || "Client : —"}
                </div>
                <div className="mt-1 text-xs text-stone-500">Émise le {fmtDate(inv.issue_date)}</div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span className="font-semibold text-white">{fmt(inv.total_ttc)}</span>
                <Badge className={statusColors[inv.status]}>{statusLabels[inv.status]}</Badge>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}