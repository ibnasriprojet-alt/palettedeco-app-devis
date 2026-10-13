import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { QuoteGroup } from "../lib/types";
import { Badge, Card, EmptyState, PageHeader, Spinner, inputCls } from "../components/ui";
import { FileText, Folder, ReceiptText, Search, SearchX } from "lucide-react";
import { cn } from "../lib/cn";

export default function Dossiers() {
  const [groups, setGroups] = useState<QuoteGroup[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .getQuoteGroups()
      .then(setGroups)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) => (g.name || "").toLowerCase().includes(q) || (g.client?.name || "").toLowerCase().includes(q),
    );
  }, [groups, query]);

  return (
    <div>
      <PageHeader title="Dossiers" subtitle={`${filtered.length} dossiers`} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-4" />
          <input
            className={cn(inputCls, "pl-9")}
            placeholder="Rechercher (dossier, client…)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : error ? (
        <Card className="text-danger">{error}</Card>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<Folder className="h-8 w-8" />}
          title="Aucun dossier"
          text="Créez un dossier depuis l'éditeur d'un devis ou la page Factures."
        />
      ) : filtered.length === 0 ? (
        <Card className="flex items-center gap-3 text-ink-3">
          <SearchX className="h-5 w-5" /> Aucun dossier ne correspond à votre recherche.
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((g) => (
            <Link
              key={g.id}
              to={`/dossiers/${g.id}`}
              className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 transition hover:border-accent/40"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Folder className="h-5 w-5 shrink-0 text-accent" />
                <div className="min-w-0">
                  <div className="truncate font-semibold text-ink">{g.name}</div>
                  <div className="truncate text-sm text-ink-3">{g.client?.name || "Client : —"}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-ink-4">
                    <span className="inline-flex items-center gap-1"><FileText className="h-3.5 w-3.5" /> {g.quote_count || 0} devis</span>
                    <span className="inline-flex items-center gap-1"><ReceiptText className="h-3.5 w-3.5" /> {g.invoice_count || 0} facture{(g.invoice_count || 0) > 1 ? "s" : ""}</span>
                  </div>
                </div>
              </div>
              <Badge
                className={
                  g.status === "chosen"
                    ? "bg-success-soft text-success border-success-line"
                    : "bg-surface-3 text-ink-2 border-line-2"
                }
              >
                {g.status === "chosen" ? "Dossier choisi" : "Dossier ouvert"}
              </Badge>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
