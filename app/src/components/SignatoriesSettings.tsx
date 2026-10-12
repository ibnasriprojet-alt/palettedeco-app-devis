import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Signatory } from "../lib/types";
import { Button, Card, Field, inputCls } from "./ui";
import { fileToPng } from "../lib/photos";
import { Check, ImagePlus, Loader2, Plus, Trash2 } from "lucide-react";

export default function SignatoriesSettings() {
  const [items, setItems] = useState<Signatory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", role: "", image: "" });

  function load() {
    api
      .getSignatories()
      .then((r) => setItems(r.items))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function patch(id: number, changes: Partial<Signatory>) {
    setItems((list) => list.map((s) => (s.id === id ? { ...s, ...changes } : s)));
  }

  async function saveField(s: Signatory, changes: Partial<Signatory>) {
    patch(s.id, changes);
    setError("");
    try {
      const updated = await api.updateSignatory(s.id, changes);
      patch(s.id, updated);
    } catch (e) {
      setError((e as Error).message);
      load();
    }
  }

  async function addItem() {
    if (!String(draft.name || "").trim()) {
      setError("Le nom du signataire est obligatoire.");
      return;
    }
    setAdding(true);
    setError("");
    try {
      const created = await api.createSignatory({
        name: draft.name.trim(),
        role: draft.role,
        image: draft.image,
        sort_order: items.length,
      });
      setItems((list) => [...list, created]);
      setDraft({ name: "", role: "", image: "" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdding(false);
    }
  }

  async function remove(s: Signatory) {
    if (!confirm(`Supprimer le signataire « ${s.name} » ?`)) return;
    setBusyId(s.id);
    setError("");
    try {
      await api.deleteSignatory(s.id);
      setItems((list) => list.filter((x) => x.id !== s.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function onImage(s: Signatory, file: File) {
    setBusyId(s.id);
    setError("");
    try {
      const dataUrl = await fileToPng(file);
      await saveField(s, { image: dataUrl });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <h2 className="mb-1 font-semibold text-ink">Signatures</h2>
      <p className="mb-4 text-xs text-ink-4">
        Personnes pouvant signer un devis. Importez une image de signature (fond transparent conseillé),
        puis cochez les personnes concernées depuis le devis.
      </p>

      {error && <div className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-6 text-ink-3"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : items.length === 0 ? (
        <p className="mb-3 text-sm text-ink-3">Aucun signataire pour le moment.</p>
      ) : (
        <div className="space-y-3">
          {items.map((s) => (
            <div key={s.id} className="rounded-xl border border-line p-3">
              <div className="flex items-start gap-3">
                <label className="flex h-16 w-24 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed border-line-2 bg-surface-2 text-ink-4 hover:border-accent/50">
                  {s.image ? (
                    <img src={s.image} alt={`Signature ${s.name}`} className="max-h-16 max-w-24 object-contain" />
                  ) : (
                    <ImagePlus className="h-5 w-5" />
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) onImage(s, f);
                    }}
                  />
                </label>

                <div className="min-w-0 flex-1">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="Nom">
                      <input
                        className={inputCls}
                        defaultValue={s.name}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== s.name) saveField(s, { name: v });
                        }}
                      />
                    </Field>
                    <Field label="Rôle (facultatif)">
                      <input
                        className={inputCls}
                        defaultValue={s.role}
                        placeholder="Gérant, couturière…"
                        onBlur={(e) => {
                          if (e.target.value !== s.role) saveField(s, { role: e.target.value });
                        }}
                      />
                    </Field>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-ink-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[var(--accent)]"
                        checked={s.active}
                        onChange={(e) => saveField(s, { active: e.target.checked })}
                      />
                      Active
                    </label>
                    {s.image && (
                      <Button
                        variant="ghost"
                        className="text-xs"
                        onClick={() => saveField(s, { image: "" })}
                        disabled={busyId === s.id}
                      >
                        Retirer l'image
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      className="ml-auto text-danger"
                      onClick={() => remove(s)}
                      disabled={busyId === s.id}
                    >
                      {busyId === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      Supprimer
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 rounded-xl border border-line-2 bg-surface-2 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Ajouter un signataire</div>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Field label="Nom">
            <input className={inputCls} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Prénom Nom" />
          </Field>
          <Field label="Rôle (facultatif)">
            <input className={inputCls} value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} placeholder="Gérant, couturière…" />
          </Field>
          <div className="flex items-end">
            <Button onClick={addItem} disabled={adding || !draft.name.trim()}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Ajouter
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-ink-4">
          Ajoutez la personne puis importez son image de signature dans la liste ci-dessus.
        </p>
      </div>

      {items.length > 0 && (
        <p className="mt-3 flex items-center gap-1 text-xs text-ink-4">
          <Check className="h-3.5 w-3.5 text-success" /> {items.length} signataire(s) enregistré(s).
        </p>
      )}
    </Card>
  );
}
