import { useEffect, useState } from "react";
import { AlertTriangle, BellRing, MailCheck, Save, ShieldAlert, ShieldCheck } from "lucide-react";
import { api } from "../lib/api";
import type { AppSettings, ReminderTemplate } from "../lib/cockpit-types";
import { Card, Field, Spinner, inputCls } from "../components/ui";
import { ConfirmCodeModal } from "../components/ConfirmModal";
import { cn } from "../lib/cn";

const LIVE_CODE = "JE-CONFIRME-ENVOIS-REELS";

/**
 * Reglages du cockpit : mode d'envoi des e-mails, regle d'echeance,
 * penalites de retard, et modeles de relance.
 */
export function CockpitSettings() {
  const [s, setS] = useState<AppSettings | null>(null);
  const [templates, setTemplates] = useState<ReminderTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [liveOpen, setLiveOpen] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([api.getSettings(), api.getReminderTemplates()])
      .then(([st, tp]) => {
        setS(st);
        setTemplates(tp.items);
        setErr("");
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const persist = async (patch: Partial<AppSettings> & { confirm_live?: string }, okMsg: string) => {
    setSaving(true);
    setErr("");
    try {
      setS(await api.saveSettings(patch));
      setMsg(okMsg);
      setTimeout(() => setMsg(""), 3000);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const saveTemplate = async (t: ReminderTemplate) => {
    try {
      const saved = await api.saveReminderTemplate(t.id!, {
        label: t.label, subject: t.subject, body: t.body, delay_days: t.delay_days, tone: t.tone, active: t.active,
      });
      setTemplates((prev) => prev.map((x) => (x.id === saved.id ? saved : x)));
      setEditing(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  if (loading || !s) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  const isLive = s.email_mode === "live";

  return (
    <div className="space-y-4">
      {err && <Card className="border-danger-line bg-danger-soft text-danger">{err}</Card>}
      {msg && <Card className="border-success-line bg-success-soft text-success">{msg}</Card>}

      {/* ---------- Mode d'envoi ---------- */}
      <Card>
        <h2 className="mb-1 flex items-center gap-2 font-semibold text-ink">
          {isLive ? <ShieldCheck className="h-4 w-4 text-success" /> : <ShieldAlert className="h-4 w-4 text-brand-2" />}
          Mode d'envoi des e-mails
        </h2>
        <p className="mb-4 text-sm text-ink-3">
          Tant que le mode test est actif, aucun message ne part vers un vrai client : tout est redirigé vers votre
          adresse de test, avec la mention [TEST] en début d'objet.
        </p>

        <div
          className={cn(
            "mb-4 rounded-lg border px-4 py-3",
            isLive ? "border-success-line bg-success-soft" : "border-brand-line bg-brand-soft",
          )}
        >
          <div className={cn("text-sm font-semibold", isLive ? "text-success" : "text-brand-2")}>
            {isLive ? "Mode réel — les e-mails partent vers vos clients" : "Mode test — aucune écriture vers un client"}
          </div>
          {s.live_enabled_at && (
            <div className="mt-0.5 text-xs text-ink-4">
              Activé le {new Date(s.live_enabled_at).toLocaleString("fr-FR")}
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Adresse e-mail de test *">
            <input
              type="email"
              className={inputCls}
              value={s.test_email}
              placeholder="vous@exemple.fr"
              onChange={(e) => setS({ ...s, test_email: e.target.value })}
              onBlur={() => persist({ test_email: s.test_email }, "Adresse de test enregistrée")}
            />
          </Field>
          <div className="flex items-end gap-2">
            {isLive ? (
              <button
                onClick={() => persist({ email_mode: "test" }, "Retour en mode test")}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg border border-line px-3.5 py-2 text-sm text-ink-3 transition hover:bg-hover disabled:opacity-50"
              >
                <ShieldAlert className="h-4 w-4" /> Revenir en mode test
              </button>
            ) : (
              <button
                onClick={() => setLiveOpen(true)}
                disabled={saving || !s.test_email.includes("@")}
                title={!s.test_email.includes("@") ? "Renseignez d'abord votre adresse e-mail de test" : undefined}
                className="inline-flex items-center gap-2 rounded-lg bg-danger px-3.5 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
              >
                <AlertTriangle className="h-4 w-4" /> Activer le mode réel
              </button>
            )}
          </div>
        </div>
        {!s.test_email.includes("@") && (
          <p className="mt-2 text-xs text-ink-4">
            Sans adresse de test, l'application bloque tous les envois : c'est volontaire.
          </p>
        )}
      </Card>

      {/* ---------- Conditions de règlement ---------- */}
      <Card>
        <h2 className="mb-1 font-semibold text-ink">Conditions de règlement</h2>
        <p className="mb-4 text-sm text-ink-3">Ces valeurs alimentent les mentions obligatoires de vos factures.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Règle d'échéance">
            <select
              className={inputCls}
              value={s.due_rule}
              onChange={(e) => persist({ due_rule: e.target.value }, "Règle d'échéance enregistrée")}
            >
              <option value="end_of_month_30">30 jours fin de mois</option>
              <option value="days_30">30 jours nets</option>
              <option value="net_15">15 jours nets</option>
            </select>
          </Field>
          <Field label="Validité des devis (jours)">
            <input
              type="number"
              className={inputCls}
              value={s.quote_validity_days}
              onChange={(e) => setS({ ...s, quote_validity_days: Number(e.target.value) })}
              onBlur={() => persist({ quote_validity_days: s.quote_validity_days }, "Validité enregistrée")}
            />
          </Field>
          <Field label="Pénalités de retard (%)">
            <input
              type="number"
              step="0.1"
              className={inputCls}
              value={s.late_penalty_rate}
              onChange={(e) => setS({ ...s, late_penalty_rate: Number(e.target.value) })}
              onBlur={() => persist({ late_penalty_rate: s.late_penalty_rate }, "Pénalités enregistrées")}
            />
          </Field>
          <Field label="Indemnité de recouvrement (€)">
            <input
              type="number"
              className={inputCls}
              value={s.recovery_fee}
              onChange={(e) => setS({ ...s, recovery_fee: Number(e.target.value) })}
              onBlur={() => persist({ recovery_fee: s.recovery_fee }, "Indemnité enregistrée")}
            />
          </Field>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Préfixe des factures">
            <input
              className={inputCls}
              value={s.invoice_prefix}
              onChange={(e) => setS({ ...s, invoice_prefix: e.target.value })}
              onBlur={() => persist({ invoice_prefix: s.invoice_prefix }, "Préfixe enregistré")}
            />
          </Field>
          <Field label="Préfixe des avoirs">
            <input
              className={inputCls}
              value={s.credit_note_prefix}
              onChange={(e) => setS({ ...s, credit_note_prefix: e.target.value })}
              onBlur={() => persist({ credit_note_prefix: s.credit_note_prefix }, "Préfixe enregistré")}
            />
          </Field>
        </div>
      </Card>

      {/* ---------- Modèles de relance ---------- */}
      <Card>
        <h2 className="mb-1 flex items-center gap-2 font-semibold text-ink">
          <BellRing className="h-4 w-4" /> Modèles de relance
        </h2>
        <p className="mb-4 text-sm text-ink-3">
          Paliers déclenchés automatiquement après le dépassement d'échéance. Les variables entre accolades sont
          remplacées au moment de l'envoi.
        </p>
        <div className="space-y-2">
          {templates.map((t) => (
            <div key={t.level} className="rounded-lg border border-line bg-surface-2 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-surface-3 px-2 py-0.5 text-xs font-semibold text-ink-2">J+{t.delay_days}</span>
                <span className="text-sm font-medium">{t.label}</span>
                {!t.active && <span className="text-xs text-ink-4">désactivé</span>}
                <button
                  onClick={() => setEditing(editing === t.level ? null : t.level)}
                  className="ml-auto text-xs text-accent hover:underline"
                >
                  {editing === t.level ? "Fermer" : "Modifier"}
                </button>
              </div>
              {editing === t.level ? (
                <div className="mt-3 space-y-2">
                  <input
                    className={inputCls}
                    value={t.label}
                    onChange={(e) => setTemplates((p) => p.map((x) => (x.level === t.level ? { ...x, label: e.target.value } : x)))}
                  />
                  <input
                    className={inputCls}
                    value={t.subject}
                    onChange={(e) => setTemplates((p) => p.map((x) => (x.level === t.level ? { ...x, subject: e.target.value } : x)))}
                  />
                  <textarea
                    className={cn(inputCls, "min-h-[180px] font-mono text-xs")}
                    value={t.body}
                    onChange={(e) => setTemplates((p) => p.map((x) => (x.level === t.level ? { ...x, body: e.target.value } : x)))}
                  />
                  <label className="flex items-center gap-2 text-sm text-ink-2">
                    <input
                      type="checkbox"
                      checked={t.active}
                      onChange={(e) => setTemplates((p) => p.map((x) => (x.level === t.level ? { ...x, active: e.target.checked } : x)))}
                      className="h-4 w-4 rounded border-line bg-surface"
                    />
                    Palier actif
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      className={cn(inputCls, "w-32")}
                      value={t.delay_days}
                      onChange={(e) => setTemplates((p) => p.map((x) => (x.level === t.level ? { ...x, delay_days: Number(e.target.value) } : x)))}
                    />
                    <button
                      onClick={() => saveTemplate(t)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-ink"
                    >
                      <Save className="h-3.5 w-3.5" /> Enregistrer
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-1 truncate text-xs text-ink-4">{t.subject}</div>
              )}
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-4">
          Variables disponibles : {"{client} {numero} {montant} {reste} {echeance} {entreprise} {telephone} {email} {siret} {iban} {penalites} {indemnite}"}
        </p>
      </Card>

      <ConfirmCodeModal
        open={liveOpen}
        danger
        title="Activer les envois réels ?"
        expectedCode={LIVE_CODE}
        confirmLabel="Activer définitivement"
        onCancel={() => setLiveOpen(false)}
        onConfirm={async () => {
          await persist({ email_mode: "live", confirm_live: LIVE_CODE }, "Mode réel activé : les e-mails partent vers vos clients.");
          setLiveOpen(false);
          load();
        }}
        body={
          <>
            <p>
              À partir de maintenant, les devis, factures et relances envoyés depuis l'application partiront vers les
              adresses e-mail réelles de vos clients.
            </p>
            <p className="mt-2 font-medium">Cette étape est irréversible sans nouvelle confirmation.</p>
            <p className="mt-2 text-ink-3">
              Vos destinataires de test : <strong>{s.test_email || "aucun"}</strong>
            </p>
          </>
        }
      />
    </div>
  );
}

export function ModeBadge({ mode }: { mode: "test" | "live" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
        mode === "live" ? "bg-success-soft text-success" : "bg-brand-soft text-brand-2",
      )}
    >
      {mode === "live" ? <MailCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
      {mode === "live" ? "Mode réel" : "Mode test"}
    </span>
  );
}
