import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, statusColors, statusLabels } from "../lib/api";
import type { Quote } from "../lib/types";
import { fmt, fmtDate } from "../lib/format";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Spinner, inputCls } from "../components/ui";
import { FilePlus2, Files, Pencil, Search, SearchX } from "lucide-react";
import { cn } from "../lib/cn";

const filters = [
  { value: "", label: "Tous" },
  { value: "draft", label: "Brouillons" },
  { value: "sent", label: "Envoyés" },
  { value: "accepted", label: "Acceptés" },
  { value: "declined", label: "Refusés" },
  { value: "invoiced", label: "Facturés" },
];

export default function Quotes() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    api
      .getQuotes(status)
      .then(setQuotes)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [status]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = quotes;
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
  }, [quotes, query, sort]);

  return (
    <div>
      <PageHeader
        title="Devis"
        subtitle={`${quotes.length} devis`}
        action={<LinkButton to="/quotes/new"><FilePlus2 className="h-4 w-4" /> Nouveau devis</LinkButton>}
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
                ? "border-[#14b8a6] bg-accent/15 text-accent"
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
      ) : quotes.length === 0 ? (
        <EmptyState
          icon={<Files className="h-8 w-8" />}
          title="Aucun devis"
          text="Créez votre premier devis pour PaletteD&co."
          action={<LinkButton to="/quotes/new"><FilePlus2 className="h-4 w-4" /> Créer un devis</LinkButton>}
        />
      ) : filtered.length === 0 ? (
        <Card className="flex items-center gap-3 text-ink-3">
          <SearchX className="h-5 w-5" /> Aucun devis ne correspond à votre recherche.
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((q) => (
            <div
              key={q.id}
              className="rounded-2xl border border-line bg-surface p-4 transition hover:border-accent/40"
            >
              <Link to={`/quotes/${q.id}`} className="block">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-ink">{q.number}</div>
                    <div className="truncate text-sm text-ink-3">{q.client?.name || "Client : —"}</div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className="font-semibold text-ink">{fmt(q.total_ttc)}</span>
                    <Badge className={statusColors[q.status]}>{statusLabels[q.status]}</Badge>
                  </div>
                </div>
                <div className="mt-2 text-xs text-ink-4">
                  Émis le {fmtDate(q.issue_date)} · Valide jusqu'au {fmtDate(q.valid_until)}
                </div>
              </Link>
              {q.status === "invoiced" && (
                <Link
                  to={`/quotes/${q.id}`}
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