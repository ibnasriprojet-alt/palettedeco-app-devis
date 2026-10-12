import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { Quote, SignedBy, Signatory } from "../lib/types";
import { today } from "../lib/format";
import { Button, Card, inputCls } from "./ui";
import { Check, PenLine, Save } from "lucide-react";

export const DEFAULT_SIGNATURE_MENTION = "Bon pour accord : le client et l'entreprise reconnaissent avoir pris connaissance des conditions et signent le devis.";

type Props = {
  quoteId: number;
  value: Pick<Quote, "signed" | "signed_at" | "signed_by" | "signature_mention">;
  onSaved?: (q: Quote) => void;
};

export default function SignatureCard({ quoteId, value, onSaved }: Props) {
  const [signatories, setSignatories] = useState<Signatory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const [signed, setSigned] = useState(!!value.signed);
  const [signedAt, setSignedAt] = useState((value.signed_at || "").slice(0, 10) || today());
  const [selected, setSelected] = useState<number[]>((value.signed_by || []).map((s: SignedBy) => s.id));
  const [mention, setMention] = useState(value.signature_mention || DEFAULT_SIGNATURE_MENTION);

  useEffect(() => {
    let alive = true;
    api
      .getSignatories()
      .then((r) => {
        if (!alive) return;
        setSignatories(r.items);
        if (!value.signature_mention) setMention(DEFAULT_SIGNATURE_MENTION);
      })
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(id: number) {
    setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const q = await api.saveQuoteSignature(quoteId, {
        signed,
        signed_at: signed ? signedAt : null,
        signed_by: signed ? selected : [],
        signature_mention: mention,
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
      onSaved?.(q);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const active = signatories.filter((s) => s.active || selected.includes(s.id));

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-ink">Signature</h2>
        {signed && <Check className="h-4 w-4 text-success" />}
      </div>

      <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-ink-2">
        <input
          type="checkbox"
          className="h-4 w-4 accent-[var(--accent)]"
          checked={signed}
          onChange={(e) => setSigned(e.target.checked)}
        />
        Devis signé par le client et l'entreprise
      </label>

      {signed && (
        <>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-3">Date de signature</span>
            <input type="date" className={inputCls} value={signedAt} onChange={(e) => setSignedAt(e.target.value)} />
          </label>

          <div>
            <span className="mb-1 block text-xs font-medium text-ink-3">Personnes ayant signé</span>
            {loading ? (
              <p className="text-sm text-ink-4">Chargement…</p>
            ) : active.length === 0 ? (
              <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-3">
                Aucun signataire.{" "}
                <Link to="/settings" className="text-accent underline">Ajoutez-en dans Réglages → Signatures</Link>.
              </p>
            ) : (
              <div className="space-y-1.5">
                {active.map((s) => (
                  <label
                    key={s.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2 transition ${selected.includes(s.id) ? "border-accent/60 bg-accent/10" : "border-line hover:bg-hover"}`}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--accent)]"
                      checked={selected.includes(s.id)}
                      onChange={() => toggle(s.id)}
                    />
                    {s.image ? (
                      <img src={s.image} alt="" className="h-8 w-16 object-contain" />
                    ) : (
                      <span className="flex h-8 w-16 items-center justify-center rounded bg-surface-3 text-ink-4">
                        <PenLine className="h-4 w-4" />
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{s.name}</span>
                      {s.role && <span className="block truncate text-xs text-ink-4">{s.role}</span>}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-3">Mention affichée sur le devis</span>
            <textarea rows={3} className={inputCls} value={mention} onChange={(e) => setMention(e.target.value)} />
          </label>
        </>
      )}

      {error && <div className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div>}

      <Button className="w-full" disabled={saving} onClick={save}>
        {saved ? <><Check className="h-4 w-4" /> Signature enregistrée</> : <><Save className="h-4 w-4" /> {saving ? "Enregistrement…" : "Enregistrer la signature"}</>}
      </Button>
    </Card>
  );
}
