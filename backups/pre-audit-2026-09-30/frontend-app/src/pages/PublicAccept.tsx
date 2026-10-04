import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api";
import { fmt, fmtDate } from "../lib/format";
import { Badge, Button, Card, Spinner } from "../components/ui";
import { Check, FileText, X } from "lucide-react";

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
  items: Array<{ description: string; quantity: number | string; unit_price: number | string; tva_rate: number | string }>;
  company: { name: string; phone: string; email: string };
}

export default function PublicAccept() {
  const { id } = useParams();
  const sig = useMemo(() => new URLSearchParams(location.search).get("sig") || "", []);

  const [data, setData] = useState<PublicInfo | null>(null);
  const [error, setError] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "done" | "already">("loading");
  const [busy, setBusy] = useState(false);

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
        setState(d.accepted ? "already" : "ready");
      })
      .catch((e) => {
        setError(e.message);
        setState("ready");
      });
  }, [id, sig]);

  async function accept() {
    if (!id) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.acceptPublicQuote(Number(id), sig);
      setState(res.already ? "already" : "done");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#1c130c] py-10 sm:py-16">
      <div className="mx-auto max-w-lg px-4">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src="/logo.png" alt="Logo" className="h-16 w-16 rounded-2xl object-contain" />
          <h1 className="mt-3 text-lg font-semibold text-white">{data?.company.name || "PaletteD&co"}</h1>
        </div>

        {state === "loading" ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : state === "done" ? (
          <Card className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
              <Check className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-semibold text-white">Devis {data?.number || ""} accepté</h2>
            <p className="mt-1 text-sm text-stone-400">Merci ! Une facture va être établie et vous recevrez le détail par e-mail.</p>
            <a href={`tel:${data?.company.phone || ""}`} className="mt-4 block text-sm text-[#14b8a6] hover:underline">
              {data?.company.phone}
            </a>
          </Card>
        ) : state === "already" ? (
          <Card>
            <h2 className="flex items-center gap-2 font-semibold text-white">
              <FileText className="h-4 w-4" /> Devis {data?.number}
            </h2>
            <div className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
              <Check className="mr-1 inline h-4 w-4" /> Ce devis a déjà été accepté.
            </div>
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-stone-400">Montant TTC</span>
              <span className="text-lg font-semibold text-white">{fmt(data?.total_ttc ?? 0)}</span>
            </div>
          </Card>
        ) : error ? (
          <Card className="text-red-300">
            <div className="flex items-center gap-2">
              <X className="h-4 w-4" /> {error}
            </div>
          </Card>
        ) : data ? (
          <Card>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm text-stone-400">Devis</h2>
                <div className="text-lg font-semibold text-white">{data.number}</div>
              </div>
              <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/40">À valider</Badge>
            </div>
            {data.client && <div className="mt-1 text-sm text-stone-400">Client : {data.client.name}</div>}
            <div className="mt-1 flex gap-4 text-xs text-stone-500">
              <span>Émis le {fmtDate(data.issue_date)}</span>
              <span>Valable jusqu'au {fmtDate(data.valid_until)}</span>
            </div>

            <div className="mt-4 divide-y divide-white/5 rounded-xl border border-white/10 bg-[#1f150d]">
              {data.items.map((it, i) => (
                <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate text-stone-200">{it.description}</div>
                    <div className="text-xs text-stone-500">
                      {it.quantity} × {fmt(it.unit_price)}
                      {Number(it.tva_rate) > 0 ? ` · TVA ${it.tva_rate}%` : " · TVA 0%"}
                    </div>
                  </div>
                  <div className="shrink-0 font-medium text-white">{fmt(Number(it.quantity) * Number(it.unit_price))}</div>
                </div>
              ))}
            </div>

            <div className="mt-4 space-y-1 text-sm">
              <div className="flex justify-between text-stone-400"><span>Total HT</span><span>{fmt(data.total_ht)}</span></div>
              <div className="flex justify-between text-stone-400"><span>TVA</span><span>{fmt(data.total_tva)}</span></div>
              <div className="flex justify-between border-t border-white/10 pt-2 font-semibold text-white"><span>Total TTC</span><span>{fmt(data.total_ttc)}</span></div>
            </div>

            {data.conditions && <div className="mt-4 text-xs text-stone-500">Conditions : {data.conditions}</div>}

            <Button className="mt-5 w-full" onClick={accept} disabled={busy}>
              <Check className="h-4 w-4" /> {busy ? "Validation..." : "Accepter le devis"}
            </Button>
            <p className="mt-2 text-center text-xs text-stone-500">
              En acceptant, vous validez le montant et les prestations ci-dessus.
            </p>
          </Card>
        ) : null}
      </div>
    </div>
  );
}