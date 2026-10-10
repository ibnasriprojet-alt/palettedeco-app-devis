import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Company } from "../lib/types";
import { Button, Card, Field, PageHeader, Spinner, inputCls } from "../components/ui";
import { CockpitSettings } from "../components/CockpitSettings";
import { Check, Download, FileText, ImagePlus, LogOut, Save, Trash2, Upload } from "lucide-react";
import { clearSession } from "./Login";
import { today } from "../lib/format";

const empty: Company = {
  id: 1, name: "", owner_name: "", siret: "", vat_number: "", address: "", email: "", phone: "",
  website: "", iban: "", bic: "", logo: "", default_tva_rate: "20",
  payment_terms: "", mentions: "",
};

const RGPD_PREFILL = `Mentions légales & RGPD
Prestataire : à compléter (nom, forme sociale, RCS/SIRET, siège social).
TVA intracommunautaire : à compléter le cas échéant.

Protection des données (RGPD) : les informations collectées (coordonnées du client) sont utilisées uniquement pour la réalisation de la prestation, l'établissement des devis et factures et le suivi de la relation commerciale. Elles ne sont en aucun cas cédées à des tiers. Conformément au Règlement (UE) 2016/679, vous disposez d'un droit d'accès, de rectification et de suppression de vos données en nous contactant à l'adresse ci-dessus.

Retard de paiement : toute somme non réglée à l'échéance entraîne des pénalités de retard égales à trois fois le taux d'intérêt légal, ainsi qu'une indemnité forfaitaire de recouvrement de 40 euros (art. L.441-10 et D.441-5 du Code de commerce).
Droit de rétractation : pour les clients particuliers, un délai de rétractation de 14 jours s'applique (art. L.221-18 du Code de la consommation).`;

export default function Settings() {
  const [company, setCompany] = useState<Company>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const savedTimer = useRef<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [backupMsg, setBackupMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .getCompany()
      .then((c) => setCompany({ ...empty, ...c }))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(
    () => () => {
      if (savedTimer.current) window.clearTimeout(savedTimer.current);
    },
    [],
  );

  function set<K extends keyof Company>(key: K, val: string) {
    setCompany((c) => ({ ...c, [key]: val }));
  }

  function onLogo(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const MAX = 256;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        set("logo", canvas.toDataURL("image/png"));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }

  async function exportBackup() {
    setBackupMsg("");
    setError("");
    try {
      const data = await api.getBackup();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `palette-sauvegarde-${today()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      /* revocation differee : une revocation synchrone peut annuler le telechargement */
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      setBackupMsg("Sauvegarde téléchargée.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function restoreBackup(file: File) {
    setBackupMsg("");
    setError("");
    try {
      const data = JSON.parse(await file.text());
      if (!confirm("La restauration remplacera TOUTES les données actuelles (clients, devis, factures) par la sauvegarde choisie. Continuer ?")) return;
      await api.restoreBackup(data);
      setBackupMsg("Sauvegarde restaurée avec succès.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const passwordChanged = !!newPassword;
      const payload: Partial<Company> = { ...company };
      if (newPassword) payload.app_password = newPassword;
      await api.saveCompany(payload);
      setNewPassword("");
      if (passwordChanged) {
        /* La session est derivee du mot de passe : le token local ne vaut plus rien.
           Sans deconnexion, toutes les requetes suivantes renvoient 401 et
           l'utilisateur se retrouve bloque sans comprendre pourquoi. */
        clearSession();
        location.assign("/login?motdepasse=change");
        return;
      }
      setSaved(true);
      if (savedTimer.current) window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Mon entreprise"
        subtitle="Les informations affichées sur vos devis et factures"
        action={
          <Button onClick={save} disabled={saving}>
            {saved ? <><Check className="h-4 w-4" /> Enregistré</> : <><Save className="h-4 w-4" /> {saving ? "Enregistrement..." : "Enregistrer"}</>}
          </Button>
        }
      />

      {error && <Card className="mb-4 border-danger-line bg-danger-soft text-danger">{error}</Card>}

      {loading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <div className="space-y-4">
            <Card>
              <h2 className="mb-3 font-semibold text-ink">Identité</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nom de l'entreprise *" className="sm:col-span-2">
                  <input className={inputCls} value={company.name} onChange={(e) => set("name", e.target.value)} placeholder="PaletteD&co" />
                </Field>
                <Field label="Gérant(e)">
                  <input className={inputCls} value={company.owner_name} onChange={(e) => set("owner_name", e.target.value)} placeholder="Prénom Nom" />
                </Field>
                <Field label="SIRET">
                  <input className={inputCls} value={company.siret} onChange={(e) => set("siret", e.target.value)} placeholder="000 000 000 00000" />
                </Field>
                <Field label="Raison sociale (facture)">
                  <input className={inputCls} value={company.legal_name || ""} onChange={(e) => set("legal_name", e.target.value)} placeholder={company.name} />
                </Field>
                <Field label="Forme juridique">
                  <input className={inputCls} value={company.legal_form || ""} onChange={(e) => set("legal_form", e.target.value)} placeholder="SARL, SAS, EI…" />
                </Field>
                <Field label="SIREN (9 chiffres)">
                  <input className={inputCls} value={company.siren || ""} onChange={(e) => set("siren", e.target.value)} />
                </Field>
                <Field label="RCS / RM">
                  <input className={inputCls} value={company.rcs || ""} onChange={(e) => set("rcs", e.target.value)} placeholder="RCS XXXXX XXX" />
                </Field>
                <Field label="Code APE / NAF">
                  <input className={inputCls} value={company.ape || ""} onChange={(e) => set("ape", e.target.value)} />
                </Field>
                <Field label="Capital social (€)">
                  <input className={inputCls} value={company.share_capital ?? ""} onChange={(e) => set("share_capital", e.target.value)} />
                </Field>
                <Field label="Adresse" className="sm:col-span-2">
                  <textarea rows={2} className={inputCls} value={company.address} onChange={(e) => set("address", e.target.value)} placeholder="Adresse complète" />
                </Field>
                <Field label="E-mail">
                  <input type="email" className={inputCls} value={company.email} onChange={(e) => set("email", e.target.value)} placeholder="contact@palettedco.fr" />
                </Field>
                <Field label="Téléphone">
                  <input type="tel" className={inputCls} value={company.phone} onChange={(e) => set("phone", e.target.value)} placeholder="06 00 00 00 00" />
                </Field>
                <Field label="Complément d'adresse">
                  <input className={inputCls} value={company.address2 || ""} onChange={(e) => set("address2", e.target.value)} />
                </Field>
                <Field label="Code postal">
                  <input className={inputCls} value={company.zip_code || ""} onChange={(e) => set("zip_code", e.target.value)} />
                </Field>
                <Field label="Ville">
                  <input className={inputCls} value={company.city || ""} onChange={(e) => set("city", e.target.value)} />
                </Field>
                <Field label="Assurance responsabilité civile">
                  <input className={inputCls} value={company.insurance || ""} onChange={(e) => set("insurance", e.target.value)} placeholder="Assureur, n° de contrat" />
                </Field>
                <Field label="Site web" className="sm:col-span-2">
                  <input className={inputCls} value={company.website} onChange={(e) => set("website", e.target.value)} placeholder="www.palettedco.fr" />
                </Field>
              </div>
            </Card>

            <Card>
              <h2 className="mb-3 font-semibold text-ink">Règlement & fiscalité</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="IBAN">
                  <input className={inputCls} value={company.iban} onChange={(e) => set("iban", e.target.value)} placeholder="FR76 ...." />
                </Field>
                <Field label="BIC">
                  <input className={inputCls} value={company.bic} onChange={(e) => set("bic", e.target.value)} placeholder="BIC" />
                </Field>
                <Field label="N° TVA intracommunautaire">
                  <input className={inputCls} value={company.vat_number} onChange={(e) => set("vat_number", e.target.value)} placeholder="FR 00 000000000" />
                </Field>
                <Field label="TVA par défaut (%)">
                  <input type="number" min="0" max="100" step="0.1" className={inputCls} value={company.default_tva_rate} onChange={(e) => set("default_tva_rate", e.target.value)} />
                </Field>
                <Field label="Conditions de règlement" className="sm:col-span-2">
                  <textarea
                    rows={3}
                    className={inputCls}
                    value={company.payment_terms}
                    onChange={(e) => set("payment_terms", e.target.value)}
                    placeholder={"Paiement accepté :\n- Virement\n- CB\n- Espèces"}
                  />
                </Field>
                <Field label="Mentions obligatoires" className="sm:col-span-2">
                  <textarea rows={3} className={inputCls} value={company.mentions} onChange={(e) => set("mentions", e.target.value)} placeholder="Mentions légales, pénalités de retard (ex : pénalités de 3 fois le taux d'intérêt légal...), escompte..." />
                </Field>
                <div className="sm:col-span-2">
                  <Button variant="ghost" className="w-full text-sm" onClick={() => set("mentions", RGPD_PREFILL)}>
                    <FileText className="h-4 w-4" /> Insérer les mentions RGPD préremplies
                  </Button>
                </div>
              </div>
            </Card>

            <CockpitSettings />

            <Card>
              <h2 className="mb-3 font-semibold text-ink">Sécurité</h2>
              <Field label="Mot de passe de connexion">
                <input
                  type="password" autoComplete="new-password"
                  className={inputCls}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Laisser vide pour ne pas le changer"
                />
              </Field>
              <p className="mt-2 text-xs text-ink-4">Le mot de passe protège l'accès au site. Enregistrez pour appliquer.</p>
              <Button
                variant="ghost"
                className="mt-4 w-full text-sm"
                onClick={() => {
                  clearSession();
                  location.href = "/";
                }}
              >
                <LogOut className="h-4 w-4" /> Se déconnecter
              </Button>
            </Card>

            <Card>
              <h2 className="mb-3 font-semibold text-ink">Sauvegarde & restauration</h2>
              <p className="mb-3 text-xs text-ink-4">Exportez vos données (clients, devis, factures, paiements) en fichier JSON pour les conserver. La restauration remplace tout par la sauvegarde choisie.</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button variant="dark" onClick={exportBackup}>
                  <Download className="h-4 w-4" /> Télécharger
                </Button>
                <input ref={restoreRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) restoreBackup(f);
                }} />
                <Button variant="ghost" onClick={() => restoreRef.current?.click()}>
                  <Upload className="h-4 w-4" /> Restaurer
                </Button>
              </div>
              {backupMsg && <p className="mt-2 text-sm text-success">{backupMsg}</p>}
            </Card>
          </div>

          <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
            <Card>
              <h2 className="mb-3 font-semibold text-ink">Logo</h2>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) onLogo(f);
                }} />
              <button
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line-2 p-5 text-ink-3 hover:border-[#14b8a6]/50 hover:text-ink"
              >
                {company.logo ? (
                  <img src={company.logo} alt="Logo" className="max-h-28 object-contain" />
                ) : (
                  <>
                    <ImagePlus className="h-8 w-8" />
                    <span className="text-sm">Ajouter un logo</span>
                  </>
                )}
              </button>
              {company.logo && (
                <Button variant="ghost" className="mt-2 w-full text-sm" onClick={() => set("logo", "")}>
                  <Trash2 className="h-4 w-4" /> Retirer le logo
                </Button>
              )}
              <p className="mt-2 text-xs text-ink-4">PNG, JPG — redimensionné automatiquement.</p>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}