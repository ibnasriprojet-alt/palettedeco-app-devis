import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api, BASE } from "../lib/api";
import { fmt, fmtDate, today } from "../lib/format";
import { Badge, Button, Card, Spinner } from "../components/ui";
import { Check, Eye, FileText, Mail, X } from "lucide-react";

interface PublicInfo {
  number: string;
  status: string;
  accepted: boolean;
  invoiced: boolean;
  issue_date: string;
  valid_until: string;
  total_ht: string | number;
  total_tva: string | number;
  total_ttc: string | number;
  conditions: string;
  notes: string;
  client: { name: string } | null;
  has_email: boolean;
  pdf_url: string;
  items: Array<{ description: string; quantity: number | string; unit_price: number | string; tva_rate: number | string }>;
  company: { name: string; phone: string; email: string };
}

export default function PublicAccept() {
  const { id } = useParams();
  const sig = useMemo(() => new URLSearchParams(location.search).get("sig") || "", []);

  const [data, setData] = useState<PublicInfo | null>(null);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "done" | "already" | "closed">("loading");
  const [busy, setBusy] = useState(false);
  const [emailRequired, setEmailRequired] = useState(false);
  const [email, setEmail] = useState("");
  const [emailNote, setEmailNote] = useState("");

  useEffect(() => {
    if (!id || !sig) {
      setError("Lien invalide ou incomplet.");
      setState("ready");
      return;
    }
    api
      .getPublicQuote(Number(id), sig)
      .then((d) => {
        setData(d);
        /* Un devis refuse, deja facture ou perime ne doit pas etre presente
           comme "a valider" : le client pouvait l'accepter alors que le
           prestataire l'avait clos. */
        setState(
          d.accepted
            ? "already"
            : d.invoiced || d.status === "declined" || (d.valid_until && d.valid_until < today())
              ? "closed"
              : "ready",
        );
      })
      .catch((e) => {
        setError(e.message);
        setState("ready");
      });
  }, [id, sig]);

  async function accept(withEmail?: string, fromForm = false) {
    if (!id) return;
    setBusy(true);
    setError("");
    setFormError("");
    setEmailNote("");
    try {
      const res = await api.acceptPublicQuote(Number(id), sig, withEmail);
      if (res.email_required) {
        setEmailRequired(true);
        setBusy(false);
        return;
      }
      setState(res.already ? "already" : "done");
      if (res.email_sent) {
        setEmailNote(
          !res.redirected
            ? "Le devis vient de vous être envoyé par e-mail."
            : "Le devis a été envoyé (mode test de l'entreprise).",
        );
      } else if (res.email_error) {
        setEmailNote(
          res.redirected
            ? "Devis validé — l'envoi par e-mail sera fait par l'entreprise (mode test)."
            : `Devis validé, mais l'envoi par e-mail a échoué (${res.email_error}).`,
        );
      }
      if (fromForm) setEmailRequired(false);
    } catch (e) {
      setError((e as Error).message);
      setFormError((e as Error).message);
      setBusy(false);
    }
  }

  function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setFormError("Veuillez saisir une adresse e-mail valide.");
      return;
    }
    setFormError("");
    accept(email.trim(), true);
  }

  return (
    <div className="min-h-screen bg-app py-10 sm:py-16">
      <div className="mx-auto max-w-lg px-4">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src="/logo.png" alt="Logo" className="h-16 w-16 rounded-2xl object-contain" />
          <h1 className="mt-3 text-lg font-semibold text-ink">{data?.company.name || "PaletteD&co"}</h1>
        </div>

        {state === "loading" ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : state === "done" ? (
          <Card className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-success-soft text-success">
              <Check className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-semibold text-ink">Devis {data?.number || ""} accepté</h2>
            <p className="mt-1 text-sm text-ink-3">Merci ! Une facture va être établie.</p>
            {emailNote ? (
              <p className="mt-3 rounded-lg bg-subtle px-3 py-2 text-sm text-ink-3">{emailNote}</p>
            ) : (
              <p className="mt-3 text-sm text-ink-4">Vous recevrez le détail par e-mail.</p>
            )}
            {data?.company.phone ? (
              <a href={`tel:${data.company.phone.replace(/\s+/g, "")}`} className="mt-4 block text-sm text-accent hover:underline">
                {data.company.phone}
              </a>
            ) : null}
          </Card>
        ) : state === "already" ? (
          <Card>
            <h2 className="flex items-center gap-2 font-semibold text-ink">
              <FileText className="h-4 w-4" /> Devis {data?.number}
            </h2>
            <div className="mt-3 rounded-lg bg-success-soft px-3 py-2 text-sm text-success">
              <Check className="mr-1 inline h-4 w-4" /> Ce devis a déjà été accepté.
            </div>
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-ink-3">Montant TTC</span>
              <span className="text-lg font-semibold text-ink">{fmt(data?.total_ttc ?? 0)}</span>
            </div>
          </Card>
        ) : !data ? (
          error ? (
            <Card className="text-danger">
              <div className="flex items-center gap-2">
                <X className="h-4 w-4" /> {error}
              </div>
            </Card>
          ) : null
        ) : (
          <Card>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm text-ink-3">Devis</h2>
                <div className="text-lg font-semibold text-ink">{data.number}</div>
              </div>
              <Badge
                className={
                  state === "ready"
                    ? "bg-success-soft text-success border-success-line"
                    : "bg-surface-3 text-ink-2 border-line-2"
                }
              >
                {state === "ready" ? "À valider" : "Clos"}
              </Badge>
            </div>
            {data.client && <div className="mt-1 text-sm text-ink-3">Client : {data.client.name}</div>}
            <div className="mt-1 flex gap-4 text-xs text-ink-4">
              <span>Émis le {fmtDate(data.issue_date)}</span>
              <span>Valable jusqu'au {fmtDate(data.valid_until)}</span>
            </div>

            <div className="mt-4 divide-y divide-line rounded-xl border border-line bg-surface-2">
              {data.items.map((it, i) => (
                <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate text-ink">{it.description}</div>
                    <div className="text-xs text-ink-4">
                      {it.quantity} × {fmt(it.unit_price)}
                      {Number(it.tva_rate) > 0 ? ` · TVA ${it.tva_rate}%` : " · TVA 0%"}
                    </div>
                  </div>
                  <div className="shrink-0 font-medium text-ink">{fmt(Number(it.quantity) * Number(it.unit_price))}</div>
                </div>
              ))}
            </div>

            <div className="mt-4 space-y-1 text-sm">
              <div className="flex justify-between text-ink-3"><span>Total HT</span><span>{fmt(data.total_ht)}</span></div>
              <div className="flex justify-between text-ink-3"><span>TVA</span><span>{fmt(data.total_tva)}</span></div>
              <div className="flex justify-between border-t border-line pt-2 font-semibold text-ink"><span>Total TTC</span><span>{fmt(data.total_ttc)}</span></div>
            </div>

            {data.conditions && <div className="mt-4 text-xs text-ink-4">Conditions : {data.conditions}</div>}

            {state === "ready" ? emailRequired ? (
                <form onSubmit={submitEmail} className="mt-5 space-y-2">
                  <p className="text-sm text-ink-3">
                    Pour vous envoyer le devis par e-mail, indiquez votre adresse e-mail :
                  </p>
                  <input
                    type="email"
                    autoComplete="email"
                    className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink outline-none focus:border-accent"
                    placeholder="votre@email.fr"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoFocus
                  />
                  {formError && <p className="text-sm text-danger">{formError}</p>}
                  <Button className="w-full" type="submit" disabled={busy}>
                    <Mail className="h-4 w-4" /> {busy ? "Envoi en cours..." : "Recevoir le devis par e-mail"}
                  </Button>
                </form>
              ) : (
                <>
                  {data.pdf_url && (
                    <a
                      href={`${BASE}${data.pdf_url}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm text-ink-3 transition hover:bg-hover"
                    >
                      <Eye className="h-4 w-4" /> Voir le devis en PDF
                    </a>
                  )}
                  <Button className="mt-3 w-full" onClick={() => accept()} disabled={busy}>
                    <Check className="h-4 w-4" /> {busy ? "Validation..." : "Accepter le devis"}
                  </Button>
                  {!data.has_email && !error && (
                    <p className="mt-2 text-xs text-ink-4">
                      Vous recevrez ensuite le devis par e-mail.
                    </p>
                  )}
                  {error && <p className="mt-2 text-center text-sm text-danger">{error}</p>}
                  <p className="mt-2 text-center text-xs text-ink-4">
                    En acceptant, vous validez le montant et les prestations ci-dessus.
                  </p>
                </>
              ) : (
                <p className="mt-5 rounded-lg bg-subtle px-3 py-2 text-center text-sm text-ink-3">
                  {data.invoiced
                    ? "Ce devis a été converti en facture."
                    : data.status === "declined"
                      ? "Ce devis a été refusé et n'est plus validable."
                      : "Ce devis n'est plus valide."}
                </p>
              )}
          </Card>
        )}
      </div>
    </div>
  );
}