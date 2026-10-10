import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Ban, Eye, MailCheck, Pause, Play, Send, Settings, ShieldAlert } from "lucide-react";
import { api } from "../lib/api";
import type { ReminderPreview, ReminderTarget, ReminderTemplate } from "../lib/cockpit-types";
import { eur } from "../lib/period";
import { fmtDate } from "../lib/format";
import { Badge, Card, EmptyState, Modal, PageHeader, Spinner } from "../components/ui";
import { ConfirmModal } from "../components/ConfirmModal";
import { cn } from "../lib/cn";

export default function Relances() {
  const [items, setItems] = useState<ReminderTarget[]>([]);
  const [templates, setTemplates] = useState<ReminderTemplate[]>([]);
  const [mode, setMode] = useState<"test" | "live">("test");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<(ReminderTarget & { level: number }) | null>(null);
  const [sending, setSending] = useState<(ReminderTarget & { level: number }) | null>(null);
  const [previewData, setPreviewData] = useState<ReminderPreview | null>(null);
  const [log, setLog] = useState<{ id: number; invoice_number: string; level: number; status: string; sent_at: string | null; redirected_to_test: boolean; client: string }[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [batchResult, setBatchResult] = useState<{ ok: boolean; sent: number; failed: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const [due, sent] = await Promise.all([api.getRemindersDue(), api.getReminderLog()]);
      setItems(due.items);
      setTemplates(due.templates);
      setMode(due.mode);
      setLog(sent.items as never);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openPreview = async (t: ReminderTarget) => {
    if (!t.niveau_suivant) return;
    setPreview({ ...t, level: t.niveau_suivant });
    setPreviewData(null);
    try {
      setPreviewData(await api.previewReminder(t.id, t.niveau_suivant));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const totalRetard = items.reduce((s, i) => s + Number(i.reste), 0);
  const actionnables = items.filter((i) => i.actionnable);
  const overdueCount = items.filter((i) => i.en_retard).length;
  const pausedCount = items.filter((i) => i.relance_pausee).length;

  const selectedItems = actionnables.filter((i) => selected.has(i.id));
  const allSelected = actionnables.length > 0 && selectedItems.length === actionnables.length;
  const selectedTotal = selectedItems.reduce((s, i) => s + Number(i.reste), 0);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(actionnables.map((i) => i.id)));
  const toggleClient = (clientId: number | null) => {
    if (clientId == null) return;
    const ids = actionnables.filter((i) => i.client_id === clientId).map((i) => i.id);
    setSelected((prev) => {
      const n = new Set(prev);
      const allChecked = ids.length > 0 && ids.every((id) => n.has(id));
      ids.forEach((id) => (allChecked ? n.delete(id) : n.add(id)));
      return n;
    });
  };

  const confirmBatch = async () => {
    if (!selectedItems.length) return;
    setBatchResult(null);
    try {
      const r = await api.sendRemindersBatch(selectedItems.map((i) => i.id));
      setSelected(new Set());
      setBatchResult(r);
      setBatchConfirm(false);
      load();
    } catch (e) {
      setError((e as Error).message);
      setBatchConfirm(false);
    }
  };

  const togglePause = async (t: ReminderTarget, paused: boolean) => {
    setError("");
    try {
      await api.setInvoiceReminderPaused(t.id, paused);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const toggleClientPause = async (clientId: number | null, paused: boolean) => {
    if (clientId == null) return;
    setError("");
    try {
      await api.setClientNoReminders(clientId, paused);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <PageHeader
        title="Centre de relances"
        subtitle="Factures en retard, niveau de relance atteint, aperçu avant envoi"
        action={
          <Link
            to="/settings"
            className="inline-flex items-center gap-2 rounded-lg border border-line px-3.5 py-2 text-sm text-ink-3 transition hover:bg-hover"
          >
            <Settings className="h-4 w-4" /> Modèles et paliers
          </Link>
        }
      />

      <div
        className={cn(
          "mb-4 flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm",
          mode === "test" ? "border-brand-line bg-brand-soft text-brand-2" : "border-success-line bg-success-soft text-success",
        )}
      >
        {mode === "test" ? <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> : <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />}
        <span>
          {mode === "test"
            ? "Mode test actif : toutes les relances sont envoyées à votre adresse de test, jamais aux clients. Activez le mode réel dans Réglages quand vous serez prêt."
            : "Mode réel actif : les relances partent vers les adresse e-mail des clients."}
        </span>
      </div>

      {error && <div className="mb-3 rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div>}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-ink-4">Factures impayées</div>
          <div className="mt-1 text-2xl font-semibold">{items.length}</div>
          {overdueCount > 0 && <div className="mt-0.5 text-xs text-danger">{overdueCount} en retard</div>}
          {pausedCount > 0 && <div className="mt-0.5 text-xs text-ink-3">{pausedCount} en pause</div>}
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-ink-4">Montant à recouvrer</div>
          <div className="mt-1 text-2xl font-semibold text-danger">{eur(totalRetard)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-ink-4">Relances à envoyer</div>
          <div className="mt-1 text-2xl font-semibold">{actionnables.length}</div>
        </Card>
      </div>

      {loading ? (
        <div className="py-10 text-center">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<MailCheck className="h-6 w-6" />}
          title="Aucune facture impayée"
          text="Toutes vos factures sont réglées. Les relances apparaîtront ici pour les factures impayées ou en retard."
        />
      ) : (
        <>
          {batchResult && (
            <div
              className={cn(
                "mb-3 rounded-lg border px-3.5 py-2.5 text-sm",
                batchResult.failed > 0
                  ? "border-danger-line bg-danger-soft text-danger"
                  : "border-success-line bg-success-soft text-success",
              )}
            >
              {batchResult.sent} relance(s) envoyée(s)
              {batchResult.failed > 0 ? `, ${batchResult.failed} échec(s).` : " — sélection réinitialisée."}
            </div>
          )}

          {selectedItems.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-brand-line bg-brand-soft px-3.5 py-2.5 text-sm text-brand-2">
              <span>
                <strong>{selectedItems.length}</strong> relance(s) sélectionnée(s) — reste dû{" "}
                <strong>{eur(selectedTotal)}</strong>
              </span>
              <button
                onClick={toggleAll}
                className="text-xs font-medium underline underline-offset-2 transition hover:text-accent"
              >
                Tout effacer
              </button>
              <button
                onClick={() => setBatchConfirm(true)}
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink transition hover:bg-accent-hover"
              >
                <Send className="h-3.5 w-3.5" /> Envoyer la sélection ({selectedItems.length})
              </button>
            </div>
          )}

          <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-4">
                <th className="w-12 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="Tout sélectionner"
                    className="h-4 w-4 cursor-pointer accent-[var(--accent)]"
                    checked={allSelected}
                    onChange={toggleAll}
                    disabled={actionnables.length === 0}
                  />
                </th>
                <th className="px-4 py-3">Facture</th>
                <th className="hidden px-4 py-3 md:table-cell">Client</th>
                <th className="px-4 py-3">Retard</th>
                <th className="px-4 py-3 text-right">Reste dû</th>
                <th className="px-4 py-3">Prochaine étape</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id} className={cn("border-b border-line last:border-0 hover:bg-subtle", selected.has(t.id) && "bg-brand-soft")}>
                  <td className="px-4 py-2.5">
                    {t.actionnable ? (
                      <input
                        type="checkbox"
                        aria-label={`Sélectionner ${t.number}`}
                        className="h-4 w-4 cursor-pointer accent-[var(--accent)]"
                        checked={selected.has(t.id)}
                        onChange={() => toggle(t.id)}
                      />
                    ) : (
                      <span className="text-ink-4">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <Link to={`/invoices/${t.id}`} className="font-medium hover:text-accent hover:underline">
                      {t.number}
                    </Link>
                    <div className="text-xs text-ink-4">échéance {fmtDate(t.due_date)}</div>
                  </td>
                  <td className="hidden px-4 py-2.5 md:table-cell">
                    <div className="flex items-center gap-2 text-ink-2">
                      <span>{t.client}</span>
                      {t.actionnable && actionnables.filter((i) => i.client_id === t.client_id).length > 1 && (
                        <button
                          onClick={() => toggleClient(t.client_id)}
                          className="rounded bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-ink-3 transition hover:bg-hover"
                          title="Sélectionner tout ce client"
                        >
                          {actionnables.filter((i) => i.client_id === t.client_id).every((i) => selected.has(i.id)) ? "désélectionner" : "tout"}
                        </button>
                      )}
                      {t.client_sans_relance ? (
                        <Badge className="border-danger-line bg-danger-soft text-danger">
                          <Ban className="mr-1 inline h-3 w-3" /> relances coupées
                        </Badge>
                      ) : (
                        <button
                          onClick={() => toggleClientPause(t.client_id, true)}
                          className="rounded bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-ink-3 transition hover:bg-hover"
                          title="Ne plus jamais relancer ce client"
                        >
                          <Ban className="mr-0.5 inline h-3 w-3" /> plus de relance
                        </button>
                      )}
                    </div>
                    <div className="truncate text-xs text-ink-4">{t.email || "aucun e-mail"}</div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    {t.en_retard ? (
                      <Badge className="border-danger-line bg-danger-soft text-danger">
                        {Math.max(t.retard_jours, 0)} j en retard
                      </Badge>
                    ) : (
                      <Badge className="border-brand-line bg-brand-soft text-brand-2">
                        échéance dans {Math.max(-t.retard_jours, 0)} j
                      </Badge>
                    )}
                    {t.relances_envoyees > 0 && (
                      <div className="mt-0.5 text-xs text-ink-4">{t.relances_envoyees} relance(s)</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{eur(t.reste)}</td>
                  <td className="px-4 py-2.5">
                    {t.relance_pausee ? (
                      <Badge className="border-brand-line bg-brand-soft text-brand-2">
                        <Pause className="mr-1 inline h-3 w-3" /> relance en pause
                      </Badge>
                    ) : t.client_sans_relance ? (
                      <span className="text-xs text-ink-3">client exclu</span>
                    ) : t.libelle_suivant ? (
                      <span className="text-ink-3">{t.libelle_suivant}</span>
                    ) : (
                      <span className="text-ink-4">paliers épuisés</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {t.actionnable ? (
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={() => openPreview(t)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-3 transition hover:bg-hover"
                        >
                          <Eye className="h-3.5 w-3.5" /> Aperçu
                        </button>
                        <button
                          onClick={() => setSending({ ...t, level: t.niveau_suivant! })}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-accent-ink transition hover:bg-accent-hover"
                        >
                          <Send className="h-3.5 w-3.5" /> Envoyer
                        </button>
                        <button
                          onClick={() => togglePause(t, true)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-3 transition hover:bg-hover"
                          title="Mettre cette relance en pause"
                        >
                          <Pause className="h-3.5 w-3.5" /> Pause
                        </button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={() => openPreview(t)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-3 transition hover:bg-hover"
                          disabled={!t.niveau_suivant}
                          title={t.niveau_suivant ? "Aperçu du prochain palier" : "Paliers épuisés"}
                        >
                          <Eye className="h-3.5 w-3.5" /> Aperçu
                        </button>
                        <button
                          onClick={() => togglePause(t, false)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-3 transition hover:bg-hover"
                          disabled={!t.relance_pausee}
                          title="Reprendre les relances pour cette facture"
                        >
                          <Play className="h-3.5 w-3.5" /> Reprendre
                        </button>
                        {t.client_sans_relance && (
                          <button
                            onClick={() => toggleClientPause(t.client_id, false)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-3 transition hover:bg-hover"
                            title="Réactiver les relances pour ce client"
                          >
                            <Play className="h-3.5 w-3.5" /> Relancer ce client
                          </button>
                        )}
                        <span className="text-xs text-ink-4">—</span>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        </>
      )}

      {log.length > 0 && (
        <Card className="mt-4 p-4">
          <div className="mb-3 text-xs uppercase tracking-wide text-ink-4">Dernières relances envoyées</div>
          <div className="space-y-2">
            {log.slice(0, 8).map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge
                  className={
                    r.status === "sent"
                      ? "border-success-line bg-success-soft text-success"
                      : "border-danger-line bg-danger-soft text-danger"
                  }
                >
                  {r.status === "sent" ? "Envoyée" : "Échec"}
                </Badge>
                <span className="font-medium">{r.invoice_number}</span>
                <span className="text-ink-3">{r.client}</span>
                <span className="text-xs text-ink-4">
                  niveau {r.level} · {r.sent_at ? fmtDate(String(r.sent_at).slice(0, 10)) : "—"}
                </span>
                {r.redirected_to_test && <Badge className="border-brand-line bg-brand-soft text-brand-2">redirigé test</Badge>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Apercu avant envoi : aucun message n'est envoye sans validation */}
      <Modal open={!!preview} title="Aperçu de la relance" onClose={() => setPreview(null)} width="max-w-2xl">
        {!previewData ? (
          <div className="py-8 text-center">
            <Spinner />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="text-xs uppercase tracking-wide text-ink-4">Destinataire client</div>
                <div className="mt-0.5 text-sm">{previewData.to_client || "aucun e-mail renseigné"}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-ink-4">Destinataire réel de l'envoi</div>
                <div className={cn("mt-0.5 text-sm font-medium", previewData.redirected && "text-brand-2")}>
                  {previewData.to_final || "aucune adresse de test"}
                </div>
              </div>
            </div>

            {previewData.redirected && (
              <div className="rounded-lg border border-brand-line bg-brand-soft px-3 py-2.5 text-sm text-brand-2">
                Mode test : ce message sera envoyé à votre adresse de test avec la mention [TEST] en début d'objet.
              </div>
            )}

            <div className="rounded-lg border border-line bg-surface-2 p-3">
              <div className="text-xs uppercase tracking-wide text-ink-4">Objet</div>
              <div className="mt-0.5 text-sm font-medium">{previewData.subject}</div>
            </div>
            <div className="rounded-lg border border-line bg-surface-2 p-3">
              <div className="text-xs uppercase tracking-wide text-ink-4">Message</div>
              <pre className="mt-1 whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-2">{previewData.body}</pre>
            </div>

            <div className="flex justify-end gap-2 border-t border-line pt-4">
              <button onClick={() => setPreview(null)} className="rounded-lg border border-line px-4 py-2 text-sm text-ink-3 hover:bg-hover">
                Fermer
              </button>
              <button
                onClick={() => {
                  if (preview) setSending(preview);
                  setPreview(null);
                }}
                disabled={!previewData.to_final}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-40"
              >
                Envoyer cette relance
              </button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={!!sending}
        title="Envoyer cette relance ?"
        busyLabel="Envoi en cours…"
        confirmLabel="Oui, envoyer"
        body={
          sending ? (
            <>
              <p>
                Facture <strong>{sending.number}</strong> — reste dû <strong>{eur(sending.reste)}</strong> (
                {sending.client}).
              </p>
              <p className="mt-2">
                Niveau : <strong>{templates.find((t) => t.level === sending.level)?.label}</strong>.
              </p>
              <p className="mt-2 text-ink-3">
                Destinataire :{" "}
                <strong>{mode === "test" ? "votre adresse de test (mode test actif)" : sending.email}</strong>.
              </p>
            </>
          ) : (
            ""
          )
        }
        onCancel={() => setSending(null)}
        onConfirm={async () => {
          if (!sending) return;
          try {
            await api.sendReminder(sending.id, sending.level);
            setSending(null);
            load();
          } catch (e) {
            setError((e as Error).message);
            setSending(null);
          }
        }}
      />

      <ConfirmModal
        open={batchConfirm}
        title="Envoyer la sélection de relances ?"
        busyLabel="Envoi en cours…"
        confirmLabel="Oui, tout envoyer"
        body={
          <>
            <p>
              <strong>{selectedItems.length}</strong> facture(s) vont être relancée(s), reste dû total{" "}
              <strong>{eur(selectedTotal)}</strong>.
            </p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-ink-3">
              {selectedItems.slice(0, 8).map((i) => (
                <li key={i.id}>
                  {i.number} — {i.client} ({templates.find((t) => t.level === i.niveau_suivant)?.label || "—"})
                </li>
              ))}
              {selectedItems.length > 8 && <li>… et {selectedItems.length - 8} autre(s)</li>}
            </ul>
            <p className="mt-2 text-ink-3">
              Destinataire :{" "}
              <strong>{mode === "test" ? "votre adresse de test (mode test actif)" : "les adresses e-mail des clients"}</strong>.
              Chaque facture reçoit le palier de relance qui correspond à son retard.
            </p>
          </>
        }
        onCancel={() => setBatchConfirm(false)}
        onConfirm={confirmBatch}
      />
    </>
  );
}

export function RelancesIcon() {
  return <AlertCircle className="h-4 w-4" />;
}