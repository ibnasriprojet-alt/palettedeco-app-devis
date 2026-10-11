import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { Button, Card, Field, PageHeader, Spinner, inputCls } from "../components/ui";
import { ArrowLeft, Save } from "lucide-react";

export default function ClientForm() {
  const { id } = useParams();
  const editId = id ? Number(id) : null;
  const navigate = useNavigate();

  const [loading, setLoading] = useState(editId ? true : false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    siret: "",
    vat_number: "",
    address: "",
    email: "",
    phone: "",
    notes: "",
    no_reminders: false,
  });

  useEffect(() => {
    if (!editId) return;
    api
      .getClients()
      .then((list) => {
        const c = list.find((x) => x.id === editId);
        if (c) setForm({ name: c.name, siret: c.siret, vat_number: c.vat_number || "", address: c.address, email: c.email, phone: c.phone, notes: c.notes, no_reminders: !!c.no_reminders });
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [editId]);

  function set<K extends keyof typeof form>(key: K, val: string | boolean) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      if (editId) await api.updateClient(editId, form);
      else await api.createClient(form);
      navigate("/clients");
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={editId ? "Modifier le client" : "Nouveau client"}
        action={
          <Link to="/clients" className="inline-flex items-center gap-1.5 rounded-lg border border-line-2 px-3 py-2 text-sm text-ink hover:bg-hover">
            <ArrowLeft className="h-4 w-4" /> Retour
          </Link>
        }
      />

      {loading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : (
        <div className="max-w-2xl">
          <Card>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nom *" className="sm:col-span-2">
                <input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Nom de l'entreprise ou du client" />
              </Field>
              <Field label="E-mail">
                <input type="email" className={inputCls} value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="contact@client.fr" />
              </Field>
              <Field label="Téléphone">
                <input type="tel" className={inputCls} value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="06 00 00 00 00" />
              </Field>
              <Field label="Adresse" className="sm:col-span-2">
                <textarea rows={2} className={inputCls} value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="Adresse complète" />
              </Field>
              <Field label="SIRET" className="sm:col-span-2">
                <input className={inputCls} value={form.siret} onChange={(e) => set("siret", e.target.value)} placeholder="000 000 000 00000" />
              </Field>
              <Field label="N° TVA intracommunautaire" className="sm:col-span-2">
                <input className={inputCls} value={form.vat_number} onChange={(e) => set("vat_number", e.target.value)} placeholder="FR 00 000000000" />
              </Field>
              <Field label="Notes" className="sm:col-span-2">
                <textarea rows={2} className={inputCls} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Notes internes (remises, récurrence...)" />
              </Field>
              <label
                htmlFor="no_reminders"
                className="sm:col-span-2 flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-subtle p-3"
              >
                <input
                  id="no_reminders"
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                  checked={!form.no_reminders}
                  onChange={(e) => set("no_reminders", !e.target.checked)}
                />
                <span className="text-sm">
                  <span className="font-medium text-ink">Relances automatiques</span>
                  <span className="block text-xs text-ink-4">
                    {form.no_reminders
                      ? "Désactivées : ce client est retiré du centre de relances (toutes ses factures impayées)."
                      : "Activées : ce client apparaît dans le centre de relances pour ses factures impayées."}
                  </span>
                </span>
              </label>
            </div>
            {error && <div className="mt-3 text-sm text-danger">{error}</div>}
            <div className="mt-4 flex gap-2">
              <Button disabled={!form.name.trim() || saving} onClick={save}>
                <Save className="h-4 w-4" /> {saving ? "Enregistrement..." : "Enregistrer"}
              </Button>
            </div>
          </Card>
          <p className="mt-2 text-xs text-ink-4">Le nom est obligatoire.</p>
        </div>
      )}
    </div>
  );
}