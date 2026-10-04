import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Eye, MailCheck, Send, Settings, ShieldAlert } from "lucide-react";
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
          <div className="text-xs uppercase tracking-wide text-ink-4">Factures en retard</div>
          <div className="mt-1 text-2xl font-semibold">{items.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wide text-ink-4">Montant en souffrance</div>
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
          title="Aucune facture en retard"
          text="Toutes vos factures sont à jour. Les relances apparaîtront ici dès qu'une facture dépassera son échéance."
        />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-4">
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
                <tr key={t.id} className="border-b border-line last:border-0 hover:bg-subtle">
                  <td className="px-4 py-2.5">
                    <Link to={`/invoices/${t.id}`} className="font-medium hover:text-accent hover:underline">
                      {t.number}
                    </Link>
                    <div className="text-xs text-ink-4">échéance {fmtDate(t.due_date)}</div>
                  </td>
                  <td className="hidden px-4 py-2.5 md:table-cell">
                    <div className="text-ink-2">{t.client}</div>
                    <div className="truncate text-xs text-ink-4">{t.email || "aucun e-mail"}</div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <Badge className="border-danger-line bg-danger-soft text-danger">{t.retard_jours} j</Badge>
                    {t.relances_envoyees > 0 && (
                      <div className="mt-0.5 text-xs text-ink-4">{t.relances_envoyees} relance(s)</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{eur(t.reste)}</td>
                  <td className="px-4 py-2.5">
                    {t.libelle_suivant ? (
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
                      </div>
                    ) : (
                      <span className="text-xs text-ink-4">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
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
    </>
  );
}

export function RelancesIcon() {
  return <AlertCircle className="h-4 w-4" />;
}