import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, statusColors, statusLabels } from "../lib/api";
import type { Quote, QuoteGroup } from "../lib/types";
import { fmt, fmtDate } from "../lib/format";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Spinner, inputCls } from "../components/ui";
import { ChevronDown, ChevronRight, CheckCircle2, Copy, FilePlus2, Files, Folder, FolderOpen, Pencil, Search, SearchX } from "lucide-react";
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
  const [groups, setGroups] = useState<QuoteGroup[]>([]);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  async function reload(currentStatus = status) {
    setError("");
    const [qs, gs] = await Promise.all([
      api.getQuotes(currentStatus),
      api.getQuoteGroups().catch(() => [] as QuoteGroup[]),
    ]);
    setQuotes(qs);
    setGroups(gs);
  }

  useEffect(() => {
    setLoading(true);
    reload(status)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const sortCmp = useMemo(() => {
    return (a: Quote, b: Quote) => {
      if (sort === "amount-desc") return Number(b.total_ttc) - Number(a.total_ttc);
      if (sort === "amount-asc") return Number(a.total_ttc) - Number(b.total_ttc);
      if (sort === "oldest") return String(a.issue_date).localeCompare(String(b.issue_date)) || a.id - b.id;
      return String(b.issue_date).localeCompare(String(a.issue_date)) || b.id - a.id;
    };
  }, [sort]);

  const { grouped, solo, groupOrder } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const searched = q
      ? quotes.filter(
          (d) =>
            (d.number || "").toLowerCase().includes(q) ||
            (d.client?.name || "").toLowerCase().includes(q) ||
            (d.client?.email || "").toLowerCase().includes(q) ||
            (d.group_name || "").toLowerCase().includes(q),
        )
      : quotes;
    const byGroup = new Map<number, Quote[]>();
    const solo: Quote[] = [];
    for (const doc of searched) {
      if (doc.group_id) {
        const arr = byGroup.get(doc.group_id) || [];
        arr.push(doc);
        byGroup.set(doc.group_id, arr);
      } else {
        solo.push(doc);
      }
    }
    for (const arr of byGroup.values()) arr.sort(sortCmp);
    solo.sort(sortCmp);
    const groupOrder = [...byGroup.keys()]
      .map((id) => groups.find((g) => g.id === id))
      .filter((g): g is QuoteGroup => !!g)
      .sort((a, b) => b.id - a.id);
    return { grouped: byGroup, solo, groupOrder };
  }, [quotes, groups, query, sortCmp]);

  function toggle(id: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function choose(groupId: number, quoteId: number) {
    if (busyId) return;
    if (!confirm("Confirmer : le client a choisi ce devis ?\nLes autres variantes du dossier passeront en « refusé ».")) return;
    setBusyId(quoteId);
    setError("");
    try {
      await api.chooseQuoteInGroup(groupId, quoteId);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function duplicate(quoteId: number) {
    if (busyId) return;
    setBusyId(quoteId);
    setError("");
    try {
      await api.duplicateQuote(quoteId);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  function QuoteRow({ q, group }: { q: Quote; group?: QuoteGroup }) {
    const chosen = group?.chosen_quote_id === q.id;
    const canChoose =
      !!group && group.status === "open" && q.status !== "declined" && q.status !== "invoiced";
    return (
      <div className={cn("rounded-2xl border bg-surface p-4 transition hover:border-accent/40", chosen ? "border-success-line" : "border-line")}>
        <div className="flex items-start justify-between gap-3">
          <Link to={`/quotes/${q.id}`} className="block min-w-0 flex-1">
            <div className="flex items-center gap-2 font-semibold text-ink">
              {q.number}
              {chosen && (
                <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success">
                  <CheckCircle2 className="h-3 w-3" /> Choix client
                </span>
              )}
            </div>
            <div className="truncate text-sm text-ink-3">{q.client?.name || "Client : —"}</div>
            <div className="mt-2 text-xs text-ink-4">
              Émis le {fmtDate(q.issue_date)} · Valide jusqu'au {fmtDate(q.valid_until)}
            </div>
          </Link>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <span className="font-semibold text-ink">{fmt(q.total_ttc)}</span>
            <Badge className={statusColors[q.status]}>{statusLabels[q.status]}</Badge>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {canChoose && (
            <button
              onClick={() => choose(group!.id, q.id)}
              disabled={busyId === q.id}
              className="flex items-center gap-1.5 rounded-lg border border-success-line bg-success-soft px-3 py-1.5 text-xs font-medium text-success transition hover:brightness-95 disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Le client a choisi ce devis
            </button>
          )}
          <Link
            to={`/quotes/${q.id}`}
            className="flex items-center gap-1.5 rounded-lg border border-line-2 px-3 py-1.5 text-xs font-medium text-ink-2 transition hover:bg-hover"
          >
            <Pencil className="h-3.5 w-3.5" /> Modifier
          </Link>
          <button
            onClick={() => duplicate(q.id)}
            disabled={busyId === q.id}
            title="Créer une variante à partir de ce devis"
            className="flex items-center gap-1.5 rounded-lg border border-line-2 px-3 py-1.5 text-xs font-medium text-ink-2 transition hover:bg-hover disabled:opacity-50"
          >
            <Copy className="h-3.5 w-3.5" /> Dupliquer
          </button>
        </div>
      </div>
    );
  }

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
            placeholder="Rechercher (numéro, client, dossier…)"
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
      ) : quotes.length === 0 ? (
        <EmptyState
          icon={<Files className="h-8 w-8" />}
          title="Aucun devis"
          text="Créez votre premier devis pour PaletteD&co."
          action={<LinkButton to="/quotes/new"><FilePlus2 className="h-4 w-4" /> Créer un devis</LinkButton>}
        />
      ) : groupOrder.length === 0 && solo.length === 0 ? (
        <Card className="flex items-center gap-3 text-ink-3">
          <SearchX className="h-5 w-5" /> Aucun devis ne correspond à votre recherche.
        </Card>
      ) : (
        <div className="space-y-6">
          {groupOrder.map((g) => {
            const list = grouped.get(g.id) || [];
            const isCollapsed = collapsed.has(g.id);
            const total = list.reduce((s, d) => s + Number(d.total_ttc), 0);
            const chosen = list.find((d) => d.id === g.chosen_quote_id);
            return (
              <div key={g.id} className="rounded-2xl border border-line bg-subtle p-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggle(g.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-hover"
                  >
                  {isCollapsed ? (
                    <ChevronRight className="h-4 w-4 shrink-0 text-ink-3" />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 text-ink-3" />
                  )}
                  <Folder className="h-5 w-5 shrink-0 text-accent" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{g.name}</span>
                      <Badge
                        className={
                          g.status === "chosen"
                            ? "bg-success-soft text-success border-success-line"
                            : "bg-surface-3 text-ink-2 border-line-2"
                        }
                      >
                        {g.status === "chosen" ? "Dossier choisi" : "Dossier ouvert"}
                      </Badge>
                    </div>
                    <div className="truncate text-xs text-ink-4">
                      {g.client?.name ? `${g.client.name} · ` : ""}
                      {list.length} devis
                      {g.invoice_count ? ` · ${g.invoice_count} facture${g.invoice_count > 1 ? "s" : ""}` : ""}
                      {" "}· {fmt(total)}
                      {chosen ? ` · retenu : ${chosen.number}` : ""}
                    </div>
                    </div>
                  </button>
                  <Link
                    to={`/dossiers/${g.id}`}
                    title="Vue combinée du dossier (devis + factures)"
                    className="mr-1 inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line-2 px-2.5 py-1.5 text-xs font-medium text-ink-2 transition hover:bg-hover"
                  >
                    <FolderOpen className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Vue du dossier</span>
                  </Link>
                </div>
                {!isCollapsed && (
                  <div className="mt-2 space-y-2">
                    {list.map((q) => (
                      <QuoteRow key={q.id} q={q} group={g} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {solo.length > 0 && (
            <div className="space-y-2">
              {groupOrder.length > 0 && (
                <div className="px-1 text-xs font-medium uppercase tracking-wide text-ink-4">Devis hors dossier</div>
              )}
              {solo.map((q) => (
                <QuoteRow key={q.id} q={q} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
