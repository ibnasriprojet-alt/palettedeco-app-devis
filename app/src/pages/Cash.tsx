import { useCallback, useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Landmark, Lock, Pencil, Plus, Trash2, Wallet } from "lucide-react";
import { api } from "../lib/api";
import type { BankAccount, BankTransaction } from "../lib/cockpit-types";
import { TX_KINDS } from "../lib/cockpit-types";
import { eur, usePeriod } from "../lib/period";
import { fmtDate } from "../lib/format";
import { Badge, Card, EmptyState, Field, Modal, PageHeader, Spinner, inputCls } from "../components/ui";
import { ConfirmModal } from "../components/ConfirmModal";
import { cn } from "../lib/cn";

const today = () => new Date().toISOString().slice(0, 10);

export default function Cash() {
  const { range } = usePeriod();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [hasAccounts, setHasAccounts] = useState(false);
  const [total, setTotal] = useState(0);
  const [tx, setTx] = useState<BankTransaction[]>([]);
  const [sums, setSums] = useState({ entries: 0, exits: 0 });
  const [filter, setFilter] = useState<number | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accountForm, setAccountForm] = useState(false);
  const [editAccount, setEditAccount] = useState<BankAccount | null>(null);
  const [accountToDelete, setAccountToDelete] = useState<BankAccount | null>(null);
  const [txForm, setTxForm] = useState(false);
  const [toDelete, setToDelete] = useState<BankTransaction | null>(null);

  const load = useCallback(async () => {
    try {
      const [cash, txs] = await Promise.all([
        api.getCash({ from: range.from, to: range.to }),
        api.getTransactions({ from: range.from, to: range.to, account_id: filter || undefined }),
      ]);
      setAccounts(cash.accounts);
      setHasAccounts(cash.has_accounts);
      setTotal(Number(cash.total) || 0);
      setTx(txs.items);
      setSums({ entries: Number(txs.total.entries) || 0, exits: Number(txs.total.exits) || 0 });
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, filter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <PageHeader
        title="Trésorerie"
        subtitle="Comptes bancaires, encaissements et sorties d'argent"
        action={
          hasAccounts ? (
            <button
              onClick={() => setTxForm(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-accent-ink transition hover:bg-accent-hover"
            >
              <Plus className="h-4 w-4" /> Saisir un mouvement
            </button>
          ) : (
            <button
              onClick={() => setAccountForm(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-accent-ink transition hover:bg-accent-hover"
            >
              <Plus className="h-4 w-4" /> Créer un compte
            </button>
          )
        }
      />

      {error && <div className="mb-3 rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div>}

      <Card className="mb-4 p-5">
        <div className="text-xs uppercase tracking-wide text-ink-4">Solde total des comptes</div>
        <div className="mt-1 text-3xl font-semibold tabular-nums">{eur(total)}</div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-2 rounded-lg bg-success-soft px-3 py-2">
            <ArrowDownRight className="h-4 w-4 text-success" />
            <span className="text-sm text-ink-3">Entrées</span>
            <span className="ml-auto font-semibold tabular-nums text-success">{eur(sums.entries)}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-danger-soft px-3 py-2">
            <ArrowUpRight className="h-4 w-4 text-danger" />
            <span className="text-sm text-ink-3">Sorties</span>
            <span className="ml-auto font-semibold tabular-nums text-danger">{eur(sums.exits)}</span>
          </div>
        </div>
      </Card>

      {loading ? (
        <div className="py-10 text-center">
          <Spinner />
        </div>
      ) : !hasAccounts ? (
        <EmptyState
          icon={<Landmark className="h-6 w-6" />}
          title="Aucun compte bancaire"
          text="Renseignez votre compte courant et vos livreurs pour suivre votre trésorerie réelle, jour après jour."
          action={
            <button onClick={() => setAccountForm(true)} className="text-sm font-medium text-accent hover:underline">
              Créer mon premier compte
            </button>
          }
        />
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map((a) => (
              <Card key={a.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{a.name}</div>
                    <div className="truncate text-xs text-ink-4">
                      {a.iban ? a.iban : a.bank_name || "—"}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {a.is_default && <Badge className="border-accent/40 bg-accent/15 text-accent">Principal</Badge>}
                    <button
                      onClick={() => setEditAccount(a)}
                      className="rounded p-1 text-ink-4 transition hover:bg-hover hover:text-ink"
                      aria-label={`Modifier ${a.name}`}
                      title="Modifier ce compte"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setAccountToDelete(a)}
                      className="rounded p-1 text-ink-4 transition hover:bg-danger-soft hover:text-danger"
                      aria-label={`Supprimer ${a.name}`}
                      title="Supprimer ce compte"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="mt-3 text-xl font-semibold tabular-nums">{eur(a.solde)}</div>
                <div className="mt-1 text-xs text-ink-4">
                  période : {Number(a.period_net) >= 0 ? "+" : ""}
                  {eur(a.period_net)}
                </div>
              </Card>
            ))}
          </div>

          <Card className="mb-4 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setAccountForm(true)}
                className="rounded-lg border border-line px-3 py-2 text-sm text-ink-3 transition hover:bg-hover"
              >
                <Plus className="mr-1.5 inline h-3.5 w-3.5" />
                Nouveau compte
              </button>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value ? Number(e.target.value) : "")}
                className={cn(inputCls, "w-auto min-w-[12rem]")}
              >
                <option value="">Tous les comptes</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          </Card>

          {tx.length === 0 ? (
            <EmptyState
              icon={<Wallet className="h-6 w-6" />}
              title="Aucun mouvement sur la période"
              text="Saisissez vos virements entrants et sortants pour obtenir un solde fiable."
            />
          ) : (
            <Card className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-4">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Libellé</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="hidden px-4 py-3 sm:table-cell">Compte</th>
                    <th className="px-4 py-3 text-right">Montant</th>
                    <th className="w-10 px-2 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {tx.map((t) => (
                    <tr key={t.id} className="border-b border-line last:border-0 hover:bg-subtle">
                      <td className="whitespace-nowrap px-4 py-2.5 text-ink-3">{fmtDate(t.tx_date)}</td>
                      <td className="px-4 py-2.5">
                        <span className="font-medium">{t.label || "—"}</span>
                        {t.invoice_number && <div className="text-xs text-ink-4">{t.invoice_number}</div>}
                        {(t.expense_id || t.payment_id) && (
                          <span className="ml-2 rounded border border-brand-line bg-brand-soft px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand-2">
                            auto
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-ink-3">{TX_KINDS.find((k) => k.id === t.kind)?.label || t.kind}</td>
                      <td className="hidden px-4 py-2.5 text-ink-4 sm:table-cell">{t.account_name || "—"}</td>
                      <td
                        className={cn(
                          "px-4 py-2.5 text-right font-semibold tabular-nums",
                          t.direction === "in" ? "text-success" : "text-danger",
                        )}
                      >
                        {t.direction === "in" ? "+" : "−"}
                        {eur(t.amount)}
                      </td>
                      <td className="px-2 py-2.5">
                        {t.expense_id || t.payment_id ? (
                          <span
                            className="block rounded p-1 text-ink-4"
                            title="Mouvement généré automatiquement depuis une dépense ou un encaissement : modifiez ou supprimez la source."
                          >
                            <Lock className="h-4 w-4" />
                          </span>
                        ) : (
                          <button
                            onClick={() => setToDelete(t)}
                            className="rounded p-1 text-ink-4 transition hover:bg-danger-soft hover:text-danger"
                            aria-label="Supprimer le mouvement"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}

      {accountForm && (
        <AccountForm
          onClose={() => setAccountForm(false)}
          onSaved={() => {
            setAccountForm(false);
            load();
          }}
        />
      )}
      {editAccount && (
        <AccountForm
          account={editAccount}
          onClose={() => setEditAccount(null)}
          onSaved={() => {
            setEditAccount(null);
            load();
          }}
        />
      )}
      {txForm && (
        <TxForm
          accounts={accounts}
          onClose={() => setTxForm(false)}
          onSaved={() => {
            setTxForm(false);
            load();
          }}
        />
      )}

      <ConfirmModal
        open={!!toDelete}
        danger
        title="Supprimer ce mouvement ?"
        body={toDelete ? `${toDelete.label || "Mouvement"} — ${eur(toDelete.amount)} du ${fmtDate(toDelete.tx_date)}. Cette opération est définitive.` : ""}
        confirmLabel="Supprimer"
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          await api.deleteTransaction(toDelete.id);
          setToDelete(null);
          load();
        }}
      />

      <ConfirmModal
        open={!!accountToDelete}
        danger
        title="Supprimer ce compte bancaire ?"
        body={
          accountToDelete ? (
            <>
              Le compte <strong>{accountToDelete.name}</strong> sera supprimé définitivement. Les mouvements qui y sont rattachés{" "}
              <strong>ne seront pas supprimés</strong> : ils resteront dans l'historique, simplement détachés de ce compte.
            </>
          ) : (
            ""
          )
        }
        confirmLabel="Supprimer le compte"
        onCancel={() => setAccountToDelete(null)}
        onConfirm={async () => {
          if (!accountToDelete) return;
          try {
            await api.deleteBankAccount(accountToDelete.id);
            setAccountToDelete(null);
            load();
          } catch (e) {
            setError((e as Error).message);
            setAccountToDelete(null);
          }
        }}
      />
    </>
  );
}

function AccountForm({ account, onClose, onSaved }: { account?: BankAccount; onClose: () => void; onSaved: () => void }) {
  const editing = !!account;
  const [f, setF] = useState({
    name: account?.name || "",
    bank_name: account?.bank_name || "",
    iban: account?.iban || "",
    bic: account?.bic || "",
    opening_balance: account ? String(account.opening_balance ?? "") : "",
    is_default: account ? !!account.is_default : true,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    if (!f.name.trim()) return setErr("Le nom du compte est obligatoire.");
    setBusy(true);
    setErr("");
    try {
      const payload = { ...f, opening_balance: Number(f.opening_balance) || 0 };
      if (editing) await api.updateBankAccount(account!.id, payload);
      else await api.createBankAccount(payload);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal open title={editing ? "Modifier le compte bancaire" : "Nouveau compte bancaire"} onClose={onClose} width="max-w-lg">
      <div className="space-y-4">
        {err && <div className="rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger">{err}</div>}
        <Field label="Nom du compte *">
          <input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Compte courant" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Banque">
            <input className={inputCls} value={f.bank_name} onChange={(e) => setF({ ...f, bank_name: e.target.value })} />
          </Field>
          <Field label="Solde d'ouverture">
            <input
              type="number"
              step="0.01"
              className={inputCls}
              value={f.opening_balance}
              onChange={(e) => setF({ ...f, opening_balance: e.target.value })}
            />
          </Field>
        </div>
        <div className="rounded-lg border border-line bg-subtle p-3">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-4">Coordonnées bancaires — facultatif</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="IBAN (facultatif)">
              <input className={cn(inputCls, "font-mono")} value={f.iban} onChange={(e) => setF({ ...f, iban: e.target.value })} placeholder="FR76 0000 0000 0000 0000 0000 000" />
            </Field>
            <Field label="BIC (facultatif)">
              <input className={cn(inputCls, "font-mono")} value={f.bic} onChange={(e) => setF({ ...f, bic: e.target.value })} />
            </Field>
          </div>
          <p className="mt-2 text-xs text-ink-4">
            Sert seulement à repérer le compte (4 derniers chiffres dans les listes). Le RIB affiché sur vos devis et factures se règle dans Réglages → Société.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={f.is_default} onChange={(e) => setF({ ...f, is_default: e.target.checked })} className="h-4 w-4 rounded border-line bg-surface-2" />
          Compte principal
        </label>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm text-ink-3 hover:bg-hover">
            Annuler
          </button>
          <button onClick={save} disabled={busy} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-50">
            {busy ? "Enregistrement…" : editing ? "Enregistrer" : "Créer le compte"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function TxForm({
  accounts,
  onClose,
  onSaved,
}: {
  accounts: BankAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState<Partial<BankTransaction>>({
    tx_date: today(),
    label: "",
    amount: "",
    direction: "in",
    kind: "payment",
    account_id: accounts.find((a) => a.is_default)?.id ?? accounts[0]?.id ?? null,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    if (!Number(f.amount)) return setErr("Le montant est obligatoire.");
    setBusy(true);
    setErr("");
    try {
      await api.createTransaction(f);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal open title="Nouveau mouvement" onClose={onClose} width="max-w-lg">
      <div className="space-y-4">
        {err && <div className="rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger">{err}</div>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date *">
            <input type="date" className={inputCls} value={String(f.tx_date || "").slice(0, 10)} onChange={(e) => setF({ ...f, tx_date: e.target.value })} />
          </Field>
          <Field label="Montant *">
            <input type="number" step="0.01" className={inputCls} value={String(f.amount ?? "")} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </Field>
        </div>
        <Field label="Libellé">
          <input className={inputCls} value={f.label || ""} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Virement reçu — Menuiserie Martin" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Sens">
            <select className={inputCls} value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value as "in" | "out" })}>
              <option value="in">Entrée (reçu)</option>
              <option value="out">Sortie (payé)</option>
            </select>
          </Field>
          <Field label="Type">
            <select className={inputCls} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              {TX_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Compte bancaire">
          <select className={inputCls} value={f.account_id ?? ""} onChange={(e) => setF({ ...f, account_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Non renseigné</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Référence">
          <input className={inputCls} value={f.reference || ""} onChange={(e) => setF({ ...f, reference: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm text-ink-3 hover:bg-hover">
            Annuler
          </button>
          <button onClick={save} disabled={busy} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-50">
            {busy ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </Modal>
  );
}