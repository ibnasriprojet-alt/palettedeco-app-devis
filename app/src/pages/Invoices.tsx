import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, statusColors, statusLabels } from "../lib/api";
import type { Invoice, QuoteGroup } from "../lib/types";
import { fmt, fmtDate } from "../lib/format";
import { Badge, Card, EmptyState, PageHeader, Spinner, inputCls } from "../components/ui";
import { ChevronDown, ChevronRight, Folder, FolderOpen, ReceiptText, Search, SearchX } from "lucide-react";
import { cn } from "../lib/cn";

export default function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [groups, setGroups] = useState<QuoteGroup[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  async function reload() {
    setError("");
    const [is, gs] = await Promise.all([api.getInvoices(), api.getQuoteGroups().catch(() => [] as QuoteGroup[])]);
    setInvoices(is);
    setGroups(gs);
  }

  useEffect(() => {
    setLoading(true);
    reload()
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          (d.quote_number || "").toLowerCase().includes(q) ||
          (d.group_name || "").toLowerCase().includes(q),
      );
    }
    return [...arr].sort((a, b) => {
      if (sort === "amount-desc") return Number(b.total_ttc) - Number(a.total_ttc);
      if (sort === "amount-asc") return Number(a.total_ttc) - Number(b.total_ttc);
      if (sort === "oldest") return String(a.issue_date).localeCompare(String(b.issue_date)) || a.id - b.id;
      return String(b.issue_date).localeCompare(String(a.issue_date)) || b.id - a.id;
    });
  }, [invoices, query, sort]);

  const { grouped, solo, groupOrder } = useMemo(() => {
    const byGroup = new Map<number, Invoice[]>();
    const solo: Invoice[] = [];
    for (const doc of filtered) {
      if (doc.group_id) {
        const arr = byGroup.get(doc.group_id) || [];
        arr.push(doc);
        byGroup.set(doc.group_id, arr);
      } else {
        solo.push(doc);
      }
    }
    const groupOrder = [...byGroup.keys()]
      .map((id) => groups.find((g) => g.id === id))
      .filter((g): g is QuoteGroup => !!g)
      .sort((a, b) => b.id - a.id);
    return { grouped: byGroup, solo, groupOrder };
  }, [filtered, groups]);

  function toggle(id: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function setGroup(inv: Invoice, value: string) {
    if (busyId) return;
    setError("");
    try {
      const clientId = inv.client?.id ?? null;
      if (value === "__new__") {
        const name = window.prompt("Nom du dossier ?");
        if (!name || !name.trim()) return;
        setBusyId(inv.id);
        const g = await api.createQuoteGroup({ name: name.trim(), client_id: clientId });
        await api.setInvoiceGroup(inv.id, { group_id: g.id });
      } else {
        setBusyId(inv.id);
        await api.setInvoiceGroup(inv.id, { group_id: value ? Number(value) : null });
      }
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  function GroupSelect({ inv }: { inv: Invoice }) {
    const clientId = inv.client?.id ?? null;
    const options = groups.filter(
      (g) => !g.client_id || g.client_id === clientId || g.id === inv.group_id,
    );
    return (
      <select
        className={cn(inputCls, "mt-2 w-full text-xs sm:w-56")}
        value={inv.group_id ? String(inv.group_id) : ""}
        disabled={busyId === inv.id}
        title="Rattacher cette facture à un dossier"
        onChange={(e) => setGroup(inv, e.target.value)}
      >
        <option value="">— Aucun dossier —</option>
        {options.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
        <option value="__new__">+ Nouveau dossier…</option>
      </select>
    );
  }

  function InvoiceCard({ inv }: { inv: Invoice }) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-4 transition hover:border-accent/40">
        <div className="flex items-start justify-between gap-3">
          <Link to={`/invoices/${inv.id}`} className="block min-w-0 flex-1">
            <div className="font-semibold text-ink">{inv.number}</div>
            <div className="truncate text-sm text-ink-3">
              {inv.quote_number ? <span className="text-ink-4">Devis {inv.quote_number} · </span> : null}
              {inv.client?.name || "Client : —"}
            </div>
            <div className="mt-1 text-xs text-ink-4">Émise le {fmtDate(inv.issue_date)}</div>
          </Link>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <span className="font-semibold text-ink">{fmt(inv.total_ttc)}</span>
            <Badge className={statusColors[inv.status]}>{statusLabels[inv.status]}</Badge>
          </div>
        </div>
        <GroupSelect inv={inv} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Factures" subtitle={`${filtered.length} factures`} />

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
          <option value="recent">Plus récentes</option>
          <option value="oldest">Plus anciennes</option>
          <option value="amount-desc">Montant décroissant</option>
          <option value="amount-asc">Montant croissant</option>
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : error ? (
        <Card className="text-danger">{error}</Card>
      ) : invoices.length === 0 ? (
        <EmptyState
          icon={<ReceiptText className="h-8 w-8" />}
          title="Aucune facture"
          text="Les factures sont créées automatiquement depuis un devis accepté."
        />
      ) : filtered.length === 0 ? (
        <Card className="flex items-center gap-3 text-ink-3">
          <SearchX className="h-5 w-5" /> Aucune facture ne correspond à votre recherche.
        </Card>
      ) : (
        <div className="space-y-6">
          {groupOrder.map((g) => {
            const list = grouped.get(g.id) || [];
            const isCollapsed = collapsed.has(g.id);
            const total = list.reduce((s, d) => s + Number(d.total_ttc), 0);
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
                        {list.length} facture{list.length > 1 ? "s" : ""}
                        {g.quote_count ? ` · ${g.quote_count} devis` : ""} · {fmt(total)}
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
                    {list.map((inv) => (
                      <InvoiceCard key={inv.id} inv={inv} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {solo.length > 0 && (
            <div className="space-y-2">
              {groupOrder.length > 0 && (
                <div className="px-1 text-xs font-medium uppercase tracking-wide text-ink-4">Factures hors dossier</div>
              )}
              {solo.map((inv) => (
                <InvoiceCard key={inv.id} inv={inv} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
