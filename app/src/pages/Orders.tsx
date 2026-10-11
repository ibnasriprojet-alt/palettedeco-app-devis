import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, statusColors, statusLabels } from "../lib/api";
import type { Order } from "../lib/types";
import { fmt, fmtDate } from "../lib/format";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Spinner, inputCls } from "../components/ui";
import { ClipboardList, FilePlus2, Pencil, Search, SearchX } from "lucide-react";
import { cn } from "../lib/cn";

const filters = [
  { value: "", label: "Tous" },
  { value: "draft", label: "Brouillons" },
  { value: "sent", label: "Envoyés" },
  { value: "accepted", label: "Acceptés" },
  { value: "declined", label: "Refusés" },
  { value: "invoiced", label: "Facturés" },
];

export default function Orders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    api
      .getOrders()
      .then(setOrders)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = status ? orders.filter((o) => o.status === status) : orders;
    if (q) {
      arr = arr.filter(
        (d) =>
          (d.number || "").toLowerCase().includes(q) ||
          (d.client?.name || "").toLowerCase().includes(q) ||
          (d.client?.email || "").toLowerCase().includes(q),
      );
    }
    return [...arr].sort((a, b) => {
      if (sort === "amount-desc") return Number(b.total_ttc) - Number(a.total_ttc);
      if (sort === "amount-asc") return Number(a.total_ttc) - Number(b.total_ttc);
      if (sort === "oldest") return String(a.issue_date).localeCompare(String(b.issue_date)) || a.id - b.id;
      return String(b.issue_date).localeCompare(String(a.issue_date)) || b.id - a.id;
    });
  }, [orders, status, query, sort]);

  return (
    <div>
      <PageHeader
        title="Bons de commande"
        subtitle={`${orders.length} bon${orders.length > 1 ? "s" : ""} de commande`}
        action={<LinkButton to="/orders/new"><FilePlus2 className="h-4 w-4" /> Nouveau bon de commande</LinkButton>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-4" />
          <input
            className={cn(inputCls, "pl-9")}
            placeholder="Rechercher (numéro, client…)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select className={cn(inputCls, "w-full sm:w-48")} value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="recent">Plus récents</option>
          <option value="oldest">Plus anciens</option>
          <option value="amount-desc">Montant décroissant</option>
          <option value="amount-asc">Montant croissant</option>
        </select>
      </div>

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatus(f.value)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-sm transition",
              status === f.value
                ? "border-accent/60 bg-accent/15 text-accent"
                : "border-line text-ink-2 hover:bg-hover",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : error ? (
        <Card className="text-danger">{error}</Card>
      ) : orders.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-8 w-8" />}
          title="Aucun bon de commande"
          text="Créez votre premier bon de commande pour PaletteD&co."
          action={<LinkButton to="/orders/new"><FilePlus2 className="h-4 w-4" /> Créer un bon de commande</LinkButton>}
        />
      ) : filtered.length === 0 ? (
        <Card className="flex items-center gap-3 text-ink-3">
          <SearchX className="h-5 w-5" /> Aucun bon de commande ne correspond à votre recherche.
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((o) => (
            <div
              key={o.id}
              className="rounded-2xl border border-line bg-surface p-4 transition hover:border-accent/40"
            >
              <Link to={`/orders/${o.id}`} className="block">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-ink">{o.number}</div>
                    <div className="truncate text-sm text-ink-3">{o.client?.name || "Client : —"}</div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className="font-semibold text-ink">{fmt(o.total_ttc)}</span>
                    <Badge className={statusColors[o.status]}>{statusLabels[o.status]}</Badge>
                  </div>
                </div>
                <div className="mt-2 text-xs text-ink-4">
                  Émis le {fmtDate(o.issue_date)} · Livraison prévue le {fmtDate(o.valid_until)}
                </div>
              </Link>
              {o.status === "invoiced" && (
                <Link
                  to={`/orders/${o.id}`}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-accent/40 px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/10"
                >
                  <Pencil className="h-3.5 w-3.5" /> Modifier
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}