import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2, Wallet } from "lucide-react";
import { api } from "../lib/api";
import type { BankAccount, Expense, ExpenseInput } from "../lib/cockpit-types";
import { EXPENSE_CATEGORIES, PAYMENT_METHODS } from "../lib/cockpit-types";
import { eur, usePeriod } from "../lib/period";
import { fmtDate } from "../lib/format";
import { Badge, Card, EmptyState, Field, Modal, PageHeader, Spinner, inputCls } from "../components/ui";
import { ConfirmModal } from "../components/ConfirmModal";
import { cn } from "../lib/cn";

const today = () => new Date().toISOString().slice(0, 10);

export default function Expenses() {
  const { range } = usePeriod();
  const [items, setItems] = useState<Expense[]>([]);
  const [total, setTotal] = useState<{ count: number; ttc: number | string; ht: number | string; tva: number | string }>({ count: 0, ttc: 0, ht: 0, tva: 0 });
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [toDelete, setToDelete] = useState<Expense | null>(null);

  const load = useCallback(async () => {
    try {
      const [res, acc] = await Promise.all([
        api.getExpenses({ from: range.from, to: range.to, q: query.trim() || undefined, category: category || undefined }),
        accounts.length ? Promise.resolve(null) : api.getBankAccounts(),
      ]);
      setItems(res.items);
      setTotal(res.total);
      if (acc) setAccounts(acc.items);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, query, category, accounts.length]);

  useEffect(() => {
    const t = setTimeout(load, query ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, query]);

  useEffect(() => {
    const onOpen = () => {
      setFormOpen(true);
      setEditing(null);
    };
    window.addEventListener("open-expense-form", onOpen);
    return () => window.removeEventListener("open-expense-form", onOpen);
  }, []);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of items) map.set(e.category, (map.get(e.category) || 0) + Number(e.amount_ttc));
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);

  const categoryLabel = (id: string) => EXPENSE_CATEGORIES.find((c) => c.id === id)?.label || id;

  return (
    <>
      <PageHeader
        title="Dépenses"
        subtitle="Fournisseurs, matières, sous-traitance et charges de l'atelier"
        action={
          <button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-accent-ink transition hover:bg-accent-hover"
          >
            <Plus className="h-4 w-4" /> Nouvelle dépense
          </button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-ink-4">Total TTC</div>
          <div className="mt-1 text-2xl font-semibold">{eur(total.ttc)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-ink-4">Total HT</div>
          <div className="mt-1 text-2xl font-semibold">{eur(total.ht)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-ink-4">TVA déductible</div>
          <div className="mt-1 text-2xl font-semibold">{eur(total.tva)}</div>
        </Card>
      </div>

      {byCategory.length > 1 && (
        <Card className="mb-4 p-4">
          <div className="text-xs uppercase tracking-wide text-ink-4">Répartition par poste</div>
          <div className="mt-3 space-y-2">
            {byCategory.map(([cat, val]) => (
              <div key={cat} className="flex items-center gap-3">
                <span className="w-32 shrink-0 truncate text-sm text-ink-3 sm:w-40">{categoryLabel(cat)}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-subtle">
                  <div
                    className="h-full rounded-full bg-brand-2"
                    style={{ width: `${Math.round((val / Math.max(1, Number(total.ttc))) * 100)}%` }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right text-sm tabular-nums">{eur(val)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="mb-4 p-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-4" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Fournisseur, libellé, n° de pièce…"
              className={cn(inputCls, "pl-9")}
            />
          </div>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={cn(inputCls, "sm:w-64")}>
            <option value="">Tous les postes</option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {error && <div className="mb-3 rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div>}

      {loading ? (
        <div className="py-10 text-center">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Wallet className="h-6 w-6" />}
          title="Aucune dépense sur la période"
          text="Enregistrez vos achats de matières, votre sous-traitance et vos charges pour suivre la trésorerie réelle."
          action={
            <button onClick={() => setFormOpen(true)} className="text-sm font-medium text-accent hover:underline">
              Enregistrer une première dépense
            </button>
          }
        />
      ) : (
        <>
          {/* Vue mobile */}
          <div className="space-y-2 md:hidden">
            {items.map((e) => (
              <Card key={e.id} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{e.supplier}</div>
                    <div className="truncate text-xs text-ink-4">
                      {fmtDate(e.expense_date)} · {categoryLabel(e.category)}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold tabular-nums">{eur(e.amount_ttc)}</div>
                    <button onClick={() => setToDelete(e)} className="mt-1 text-ink-4 hover:text-danger" aria-label="Supprimer">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {e.label && <div className="mt-1 truncate text-xs text-ink-3">{e.label}</div>}
              </Card>
            ))}
          </div>

          {/* Vue bureau */}
          <Card className="hidden overflow-hidden md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-4">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Fournisseur</th>
                  <th className="px-4 py-3">Poste</th>
                  <th className="px-4 py-3">Libellé</th>
                  <th className="px-4 py-3 text-right">HT</th>
                  <th className="px-4 py-3 text-right">TVA</th>
                  <th className="px-4 py-3 text-right">TTC</th>
                  <th className="w-10 px-2 py-3" />
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id} className="border-b border-line last:border-0 hover:bg-subtle">
                    <td className="whitespace-nowrap px-4 py-2.5 text-ink-3">{fmtDate(e.expense_date)}</td>
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{e.supplier}</span>
                      {e.reference && <div className="text-xs text-ink-4">{e.reference}</div>}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge className="border-line-2 bg-surface-3 text-ink-3">{categoryLabel(e.category)}</Badge>
                    </td>
                    <td className="max-w-xs truncate px-4 py-2.5 text-ink-3">{e.label || "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{eur(e.amount_ht)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink-4">
                      {eur((Number(e.amount_ht) * Number(e.tva_rate)) / 100)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{eur(e.amount_ttc)}</td>
                    <td className="px-2 py-2.5">
                      <button
                        onClick={() => setToDelete(e)}
                        className="rounded p-1 text-ink-4 transition hover:bg-danger-soft hover:text-danger"
                        aria-label="Supprimer la dépense"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {formOpen && (
        <ExpenseForm
          expense={editing}
          accounts={accounts}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
            window.dispatchEvent(new CustomEvent("expense-form-closed"));
          }}
          onSaved={() => {
            setFormOpen(false);
            setEditing(null);
            setLoading(true);
            load();
          }}
        />
      )}

      <ConfirmModal
        open={!!toDelete}
        title="Supprimer cette dépense ?"
        body={
          toDelete
            ? `${toDelete.supplier} — ${eur(toDelete.amount_ttc)} du ${fmtDate(toDelete.expense_date)}. Cette opération est définitive et ne peut pas être annulée.`
            : ""
        }
        confirmLabel="Supprimer définitivement"
        danger
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await api.deleteExpense(toDelete.id);
            setToDelete(null);
            load();
          } catch (e) {
            setError((e as Error).message);
            setToDelete(null);
          }
        }}
      />
    </>
  );
}

function ExpenseForm({
  expense,
  accounts,
  onClose,
  onSaved,
}: {
  expense: Expense | null;
  accounts: BankAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState<ExpenseInput>({
    expense_date: today(),
    supplier: "",
    category: "fournisseur",
    label: "",
    reference: "",
    amount_ht: "",
    tva_rate: 20,
    payment_method: "virement",
    deductible_tva: true,
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (expense) setF({ ...expense });
  }, [expense]);

  const ht = Number(f.amount_ht) || 0;
  const taux = Number(f.tva_rate) || 0;
  const ttc = Math.round(ht * (1 + taux / 100) * 100) / 100;

  const save = async () => {
    if (!String(f.supplier || "").trim()) return setErr("Le fournisseur est obligatoire.");
    if (ht <= 0) return setErr("Le montant HT doit être supérieur à 0.");
    setBusy(true);
    setErr("");
    try {
      const payload = { ...f, amount_ttc: ttc };
      if (expense) await api.updateExpense(expense.id, payload);
      else await api.createExpense(payload);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal open title={expense ? "Modifier la dépense" : "Nouvelle dépense"} onClose={onClose} width="max-w-2xl">
      <div className="space-y-4">
        {err && <div className="rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger">{err}</div>}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Fournisseur *">
            <input
              className={inputCls}
              value={f.supplier || ""}
              onChange={(e) => setF({ ...f, supplier: e.target.value })}
              placeholder="Nom du fournisseur"
            />
          </Field>
          <Field label="Date de la dépense *">
            <input
              type="date"
              className={inputCls}
              value={String(f.expense_date || "").slice(0, 10)}
              onChange={(e) => setF({ ...f, expense_date: e.target.value })}
            />
          </Field>
        </div>

        <Field label="Libellé">
          <input
            className={inputCls}
            value={f.label || ""}
            onChange={(e) => setF({ ...f, label: e.target.value })}
            placeholder="Chêne massif 8/8, 2,5 m — 12 planches"
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Poste de dépense">
            <select
              className={inputCls}
              value={f.category}
              onChange={(e) => setF({ ...f, category: e.target.value })}
            >
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="N° de pièce">
            <input
              className={inputCls}
              value={f.reference || ""}
              onChange={(e) => setF({ ...f, reference: e.target.value })}
              placeholder="FAC-2026-0142"
            />
          </Field>
          <Field label="Règlement">
            <select
              className={inputCls}
              value={f.payment_method}
              onChange={(e) => setF({ ...f, payment_method: e.target.value })}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Montant HT *">
            <input
              type="number"
              step="0.01"
              min="0"
              className={inputCls}
              value={String(f.amount_ht ?? "")}
              onChange={(e) => setF({ ...f, amount_ht: e.target.value })}
            />
          </Field>
          <Field label="Taux de TVA">
            <select
              className={inputCls}
              value={String(f.tva_rate ?? 0)}
              onChange={(e) => setF({ ...f, tva_rate: Number(e.target.value) })}
            >
              {[0, 2.1, 5.5, 10, 20].map((t) => (
                <option key={t} value={t}>
                  {t} %
                </option>
              ))}
            </select>
          </Field>
          <Field label="Total TTC (calculé)">
            <input className={cn(inputCls, "bg-subtle text-ink-3")} value={eur(ttc)} readOnly />
          </Field>
        </div>

        {accounts.length > 0 && (
          <Field label="Compte bancaire de sortie">
            <select
              className={inputCls}
              value={f.account_id ?? ""}
              onChange={(e) => setF({ ...f, account_id: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">Non renseigné</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.iban ? ` — ${a.iban.slice(-4)}` : ""}
                </option>
              ))}
            </select>
          </Field>
        )}

        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            checked={!!f.deductible_tva}
            onChange={(e) => setF({ ...f, deductible_tva: e.target.checked })}
            className="h-4 w-4 rounded border-line bg-surface-2"
          />
          TVA déductible (elle sera déduite de votre TVA collectée)
        </label>

        <Field label="Notes">
          <textarea
            className={cn(inputCls, "min-h-[70px]")}
            value={f.notes || ""}
            onChange={(e) => setF({ ...f, notes: e.target.value })}
          />
        </Field>

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm text-ink-3 hover:bg-hover">
            Annuler
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? "Enregistrement…" : expense ? "Modifier" : "Enregistrer"}
          </button>
        </div>
      </div>
    </Modal>
  );
}