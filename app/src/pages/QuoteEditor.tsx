import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, statusLabels } from "../lib/api";
import type { Client, Company, QuoteItem, QuoteStatus } from "../lib/types";
import { addDays, fmt, money, round2, today } from "../lib/format";
import { Button, Card, Field, PageHeader, Spinner, inputCls } from "../components/ui";
import { fileToPhoto, MAX_PHOTOS } from "../lib/photos";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bold,
  ImagePlus,
  Italic,
  Plus,
  Printer,
  Save,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { cn } from "../lib/cn";

const tvaRates = ["20", "10", "5.5", "2.1", "0"];

export default function QuoteEditor({ kind = "quote" }: { kind?: "quote" | "order" }) {
  const { id } = useParams();
  const editId = id ? Number(id) : null;
  const navigate = useNavigate();
  const isQuote = kind === "quote";
  const listPath = isQuote ? "/quotes" : "/orders";

  const [company, setCompany] = useState<Company | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [frozen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [invoiced, setInvoiced] = useState(false);
  const [syncedInvoice, setSyncedInvoice] = useState<number | null>(null);

  const [number, setNumber] = useState("");
  const [clientId, setClientId] = useState<number | "">("");
  const [status, setStatus] = useState<QuoteStatus>("draft");
  const [issueDate, setIssueDate] = useState(today());
  const [validUntil, setValidUntil] = useState(addDays(30));
  const [conditions, setConditions] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<QuoteItem[]>([{ description: "", quantity: 1, unit_price: "", tva_rate: "" }]);
  const [photos, setPhotos] = useState<string[]>([]);

  const [autoState, setAutoState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [autoError, setAutoError] = useState("");
  const hydratedRef = useRef(false);
  const skipRef = useRef(false);
  const inflightRef = useRef(false);
  const pendingRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const payloadRef = useRef<Record<string, unknown> | null>(null);
  const loadedIdRef = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    if (loadedIdRef.current === editId) return;
    loadedIdRef.current = editId;
    /* Neutralise l'auto-save tant que le document n'est pas hydrate, et arme
       le "skip" du prochain passage pour ne pas renvoyer l'ancien formulaire. */
    hydratedRef.current = false;
    skipRef.current = true;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    async function load() {
      let com: Awaited<ReturnType<typeof api.getCompany>> | null = null;
      try {
        const [comRes, cl] = await Promise.all([api.getCompany(), api.getClients()]);
        com = comRes;
        setCompany(comRes);
        setClients(cl);
        setConditions(comRes.payment_terms || "");
        setItems((prev) => prev.map((it) => (it.tva_rate ? it : { ...it, tva_rate: comRes.default_tva_rate })));
      } catch (e) {
        setError((e as Error).message);
      }
      if (editId) {
        try {
          const q = await (isQuote ? api.getQuote(editId) : api.getOrder(editId));
          setNumber(q.number);
          setClientId(q.client_id || "");
          setStatus(q.status);
          setIssueDate(q.issue_date);
          setValidUntil(q.valid_until);
          setConditions(q.conditions);
          setNotes(q.notes);
          setItems(
            q.items.length
              ? q.items.map((i) => ({ ...i }))
              : /* com et non company : la closure capture l'etat au 1er rendu (null) */
                [{ description: "", quantity: 1, unit_price: "", tva_rate: com?.default_tva_rate || "" }],
          );
          setPhotos(Array.isArray(q.photos) ? q.photos : []);
          setInvoiced(q.status === "invoiced");
          setError("");
          hydratedRef.current = true;
          skipRef.current = true;
        } catch (e) {
          setError((e as Error).message);
          hydratedRef.current = true;
        }
      } else {
        /* nouveau document : on repart d'un formulaire vierge */
        setNumber("");
        setClientId("");
        setStatus("draft");
        setIssueDate(today());
        setValidUntil(addDays(30));
        setNotes("");
        setPhotos([]);
        setInvoiced(false);
        setError("");
        hydratedRef.current = true;
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, isQuote]);

  const totals = useMemo(() => {
    let ht = 0;
    let tva = 0;
    const byRate: Record<string, { rate: number; base: number }> = {};
    for (const it of items) {
      const qty = round2(it.quantity);
      const unit = round2(it.unit_price);
      const rate = round2(it.tva_rate);
      const lineHt = money(qty * unit);
      /* meme ordre d'arrondi que le serveur (computeTotals) : arrondir la TVA
         de chaque ligne, sinon l'ecran et le PDF peuvent differer d'un centime. */
      const lineTva = money(lineHt * (rate / 100));
      ht = money(ht + lineHt);
      tva = money(tva + lineTva);
      const key = String(rate);
      byRate[key] = byRate[key] || { rate, base: 0 };
      byRate[key].base = money(byRate[key].base + lineHt);
    }
    return { ht: money(ht), tva: money(tva), ttc: money(ht + tva), byRate: Object.values(byRate) };
  }, [items]);

  function updateItem(idx: number, patch: Partial<QuoteItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function autoGrowEl(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}
function autoGrow(ev: { currentTarget: HTMLTextAreaElement }) {
  autoGrowEl(ev.currentTarget);
}
function growRef(el: HTMLTextAreaElement | null) {
  if (el) autoGrowEl(el);
}

function addLine() {
    setItems((prev) => [...prev, { description: "", quantity: 1, unit_price: "", tva_rate: company?.default_tva_rate || "" }]);
  }

  function removeLine(idx: number) {
    setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : [{ description: "", quantity: 1, unit_price: "", tva_rate: company?.default_tva_rate || "" }]));
  }

  function moveItem(idx: number, dir: -1 | 1) {
    setItems((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }

  async function onSelectPhotos(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) return;
    setError("");
    try {
      const converted = await Promise.all(files.slice(0, room).map(fileToPhoto));
      setPhotos((prev) => [...prev, ...converted].slice(0, MAX_PHOTOS));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function buildPayload(nextStatus?: QuoteStatus) {
    return {
      client_id: clientId === "" ? null : Number(clientId),
      status: nextStatus || status,
      number: number.trim(),
      issue_date: issueDate,
      valid_until: validUntil,
      conditions,
      notes,
      items: items.map((it) => ({
        description: it.description,
        quantity: round2(it.quantity),
        unit_price: round2(it.unit_price),
        tva_rate: round2(it.tva_rate),
        align: it.align || "left",
        bold: !!it.bold,
        italic: !!it.italic,
        is_block: !!it.is_block,
      })),
      photos,
    };
  }

  async function runAutoSave() {
    const payload = payloadRef.current;
    if (!payload || !editId) return;
    if (inflightRef.current) {
      pendingRef.current = true;
      return;
    }
    inflightRef.current = true;
    setAutoState("saving");
    setAutoError("");
    try {
      await (isQuote ? api.updateQuote(editId, payload) : api.updateOrder(editId, payload));
      setAutoState(pendingRef.current ? "saving" : "saved");
    } catch (e) {
      setAutoError((e as Error).message);
      setAutoState("error");
    } finally {
      inflightRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        setAutoState("saving");
        runAutoSave();
      }
    }
  }

  useEffect(() => {
    if (!editId || frozen || !hydratedRef.current) return;
    if (skipRef.current) {
      skipRef.current = false;
      return;
    }
    payloadRef.current = buildPayload();
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(runAutoSave, 900);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [number, clientId, status, issueDate, validUntil, conditions, notes, items, photos, editId, frozen, isQuote]);

  async function save(nextStatus?: QuoteStatus) {
    setSaving(true);
    setError("");
    setAutoError("");
    const payload = buildPayload(nextStatus);
    try {
      const q = editId
        ? isQuote
          ? await api.updateQuote(editId, payload)
          : await api.updateOrder(editId, payload)
        : isQuote
          ? await api.createQuote(payload)
          : await api.createOrder(payload);
      setSyncedInvoice((q as { synced_invoice_id?: number | null }).synced_invoice_id ?? null);
      navigate(`${listPath}/${q.id}`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={editId ? (isQuote ? "Modifier le devis" : "Modifier le bon de commande") : isQuote ? "Nouveau devis" : "Nouveau bon de commande"}
        subtitle={editId ? number : "Numéro auto attribué à l'enregistrement (ou saisissez le vôtre)"}
        action={
          <div className="flex items-center gap-2">
            <Link to={listPath} className="inline-flex items-center gap-1.5 rounded-lg border border-line-2 px-3 py-2 text-sm text-ink hover:bg-hover">
              <ArrowLeft className="h-4 w-4" /> Retour
            </Link>
            {editId && (
              <Link
                to={`${listPath}/${editId}/view`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#f59e0b]/40 px-3 py-2 text-sm text-brand-2 hover:bg-brand-soft"
              >
                <Printer className="h-4 w-4" /> Aperçu / PDF
              </Link>
            )}
          </div>
        }
      />

      {error && <Card className="mb-4 border-danger-line bg-danger-soft text-danger">{error}</Card>}

      {frozen && (
        <Card className="mb-4 border-brand-line bg-brand-soft text-brand-2">
          {isQuote ? "Ce devis" : "Ce bon de commande"} est en lecture seule.{" "}
          <Link to={`${listPath}/${editId}/view`} className="underline">Voir l'aperçu</Link>
        </Card>
      )}

      {invoiced && (
        <Card className="mb-4 border-brand-line bg-brand-soft text-brand-2">
          {isQuote ? "Ce devis" : "Ce bon de commande"} a été facturé : les modifications sont appliquées automatiquement à la facture liée.{" "}
          <Link to={`${listPath}/${editId}/view`} className="underline">Voir l'aperçu</Link>
        </Card>
      )}

      {syncedInvoice && (
        <Card className="mb-4 border-success-line bg-success-soft text-success">
          Modifications enregistrées — la facture associée a été mise à jour.{" "}
          <Link to={`/invoices/${syncedInvoice}`} className="underline">Ouvrir la facture</Link>
        </Card>
      )}

      {!company ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <Card>
              <h2 className="mb-3 font-semibold text-ink">{isQuote ? "Informations du devis" : "Informations du bon de commande"}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Client">
                  <select
                    className={inputCls}
                    value={clientId}
                    disabled={frozen}
                    onChange={(e) => setClientId(e.target.value === "" ? "" : Number(e.target.value))}
                  >
                    <option value="">— Sélectionner un client —</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Numéro (vide = auto)">
                  <input
                    className={inputCls}
                    placeholder={isQuote ? "Ex : DEV-2026-001" : "Ex : BC-2026-001"}
                    value={number}
                    disabled={frozen}
                    onChange={(e) => setNumber(e.target.value)}
                  />
                </Field>
                <Field label="Statut">
                  <select className={inputCls} value={status} disabled={frozen || invoiced} onChange={(e) => setStatus(e.target.value as QuoteStatus)}>
                    {Object.entries(statusLabels).slice(0, 4).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Date d'émission">
                  <input type="date" className={inputCls} value={issueDate} disabled={frozen} onChange={(e) => setIssueDate(e.target.value)} />
                </Field>
                <Field label={isQuote ? "Date de validité" : "Date de livraison prévue"}>
                  <input type="date" className={inputCls} value={validUntil} disabled={frozen} onChange={(e) => setValidUntil(e.target.value)} />
                </Field>
              </div>
            </Card>

            <Card>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-semibold text-ink">Photos de réalisation</h2>
                {!frozen && photos.length < MAX_PHOTOS && (
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line-2 px-3 py-1.5 text-xs text-ink transition hover:bg-hover">
                    <ImagePlus className="h-3.5 w-3.5" /> Ajouter
                    <input type="file" accept="image/*" multiple className="hidden" onChange={onSelectPhotos} />
                  </label>
                )}
              </div>
              <p className="mb-3 text-xs text-ink-4">
                {isQuote ? "Ces photos apparaissent sur le devis (PDF et email)." : "Ces photos apparaissent sur le bon de commande (PDF et email)."} Maximum {MAX_PHOTOS} images.
              </p>
              {photos.length === 0 ? (
                <div className="rounded-xl border border-dashed border-line-2 py-8 text-center text-sm text-ink-4">
                  Aucune photo — ajoutez des photos de vos réalisations.
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {photos.map((p, i) => (
                    <div key={i} className="group relative aspect-[4/3] overflow-hidden rounded-xl border border-line">
                      <img src={p} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                      {!frozen && (
                        <button
                          type="button"
                          className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-80 transition hover:bg-red-600/90 group-hover:opacity-100"
                          title="Retirer cette photo"
                          onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold text-ink">Lignes</h2>
                <Button variant="dark" onClick={addLine} disabled={frozen} className="px-3 py-1.5 text-xs">
                  <Plus className="h-3.5 w-3.5" /> Ajouter
                </Button>
              </div>
              <div className="hidden sm:block">
                <div className="ml-auto flex max-w-xl gap-2 px-1 pb-1 text-[11px] uppercase tracking-wide text-ink-4">
                  <span className="flex-1 text-right">Qté</span>
                  <span className="flex-1 text-right">Prix HT</span>
                  <span className="flex-1 text-right">TVA %</span>
                  <span className="flex-1 text-right">Total HT</span>
                </div>
              </div>
              <div className="space-y-2">
                {items.map((it, idx) => {
                  const lineHt = money(round2(it.quantity) * round2(it.unit_price));
                  const alignCls = it.align === "center" ? "text-center" : it.align === "right" ? "text-right" : "";
                  const tbtn = "flex h-7 w-7 items-center justify-center rounded-md text-sm text-ink-3 hover:bg-hover disabled:opacity-25 disabled:hover:bg-transparent";
                  return (
                    <div key={idx} className={cn("rounded-xl border border-line bg-subtle p-2", it.is_block && "border-dashed")}>
                      {it.is_block ? (
                        <textarea
                          rows={1}
                          ref={growRef}
                          className={cn(inputCls, "min-h-[52px] w-full resize-none overflow-hidden text-[16px] leading-snug sm:text-sm", alignCls, it.bold && "font-bold", it.italic && "italic")}
                          placeholder="Titre de section ou texte libre (Entrée = nouvelle ligne)"
                          value={it.description}
                          disabled={frozen}
                          onInput={autoGrow}
                          onChange={(e) => updateItem(idx, { description: e.target.value })}
                        />
                      ) : (
                        <>
                          <textarea
                            rows={1}
                            ref={growRef}
                            className={cn(inputCls, "min-h-[52px] w-full resize-none overflow-hidden text-[16px] leading-snug sm:text-sm", alignCls, it.bold && "font-bold", it.italic && "italic")}
                            placeholder="Décrivez la prestation… (Entrée = nouvelle ligne)"
                            value={it.description}
                            disabled={frozen}
                            onInput={autoGrow}
                            onChange={(e) => updateItem(idx, { description: e.target.value })}
                          />
                          <div className="mt-2 grid grid-cols-2 gap-2 sm:ml-auto sm:max-w-xl sm:grid-cols-4">
                            <input
                              type="number" inputMode="decimal" min="0" step="0.01"
                              className={cn(inputCls, "text-[16px] sm:text-sm")}
                              placeholder="Qté"
                              value={it.quantity}
                              disabled={frozen}
                              onChange={(e) => updateItem(idx, { quantity: e.target.value })}
                            />
                            <input
                              type="number" inputMode="decimal" min="0" step="0.01"
                              className={cn(inputCls, "text-[16px] sm:text-sm")}
                              placeholder="Prix €"
                              value={it.unit_price}
                              disabled={frozen}
                              onChange={(e) => updateItem(idx, { unit_price: e.target.value })}
                            />
                            <select
                              className={cn(inputCls, "text-[16px] sm:text-sm")}
                              value={it.tva_rate}
                              disabled={frozen}
                              onChange={(e) => updateItem(idx, { tva_rate: e.target.value })}
                            >
                              {tvaRates.map((r) => (
                                <option key={r} value={r}>{r}</option>
                              ))}
                            </select>
                            <div className="py-2 text-right text-sm font-medium text-ink">
                              {fmt(lineHt)}
                            </div>
                          </div>
                        </>
                      )}
                      {!frozen && (
                        <div className="mt-1.5 flex items-center gap-1">
                          <button className={tbtn} disabled={idx === 0} title="Monter" onClick={() => moveItem(idx, -1)}><ArrowUp className="h-3.5 w-3.5" /></button>
                          <button className={tbtn} disabled={idx === items.length - 1} title="Descendre" onClick={() => moveItem(idx, 1)}><ArrowDown className="h-3.5 w-3.5" /></button>
                          <span className="mx-1 h-4 w-px bg-hover" />
                          <button className={cn(tbtn, it.bold && "bg-hover text-ink")} title="Gras" onClick={() => updateItem(idx, { bold: !it.bold })}><Bold className="h-3.5 w-3.5" /></button>
                          <button className={cn(tbtn, it.italic && "bg-hover text-ink")} title="Italique" onClick={() => updateItem(idx, { italic: !it.italic })}><Italic className="h-3.5 w-3.5" /></button>
                          <button className={cn(tbtn, it.align === "left" && "bg-hover text-ink")} title="Aligné à gauche" onClick={() => updateItem(idx, { align: "left" })}><AlignLeft className="h-3.5 w-3.5" /></button>
                          <button className={cn(tbtn, it.align === "center" && "bg-hover text-ink")} title="Centré" onClick={() => updateItem(idx, { align: "center" })}><AlignCenter className="h-3.5 w-3.5" /></button>
                          <button className={cn(tbtn, it.align === "right" && "bg-hover text-ink")} title="Aligné à droite" onClick={() => updateItem(idx, { align: "right" })}><AlignRight className="h-3.5 w-3.5" /></button>
                          <button className={cn(tbtn, it.is_block && "bg-hover text-ink")} title="Texte libre pleine largeur (titre/section)" onClick={() => updateItem(idx, { is_block: !it.is_block })}><Type className="h-3.5 w-3.5" /></button>
                          <span className="mx-1 h-4 w-px bg-hover" />
                          <button className={tbtn + " ml-auto hover:text-danger"} title="Supprimer la ligne" onClick={() => removeLine(idx)}><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Conditions de règlement">
                  <textarea
                    rows={3}
                    className={inputCls}
                    placeholder="Ex : Paiement à réception de facture..."
                    value={conditions}
                    disabled={frozen}
                    onChange={(e) => setConditions(e.target.value)}
                  />
                </Field>
                <Field label="Notes / mentions">
                  <textarea
                    rows={3}
                    className={inputCls}
                    placeholder="Mentions personnalisées, délais..."
                    value={notes}
                    disabled={frozen}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </Field>
              </div>
            </Card>
          </div>

          <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
            <Card>
              <h2 className="mb-3 font-semibold text-ink">Totaux</h2>
              <div className="space-y-1.5 text-sm">
                {totals.byRate.length > 0 && totals.byRate.filter((r) => r.base > 0).map((r) => (
                  <div key={r.rate} className="flex justify-between text-ink-2">
                    <span>Base HT {r.rate}%</span>
                    <span>{fmt(r.base)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-line pt-2 text-ink-2">
                  <span>Total HT</span>
                  <span className="font-medium text-ink">{fmt(totals.ht)}</span>
                </div>
                <div className="flex justify-between text-ink-2">
                  <span>TVA</span>
                  <span className="font-medium text-ink">{fmt(totals.tva)}</span>
                </div>
                <div className="flex justify-between border-t border-line pt-2 text-base font-semibold">
                  <span>Total TTC</span>
                  <span className="text-accent">{fmt(totals.ttc)}</span>
                </div>
              </div>
            </Card>

            <Card className="space-y-2">
              {editId && !frozen && (
                <div className="min-h-[16px] text-center text-xs">
                  {autoState === "saving" && <span className="text-ink-3">Enregistrement automatique…</span>}
                  {autoState === "saved" && <span className="text-success">✓ Enregistré automatiquement</span>}
                  {autoState === "error" && <span className="text-danger">Échec auto-save : {autoError}</span>}
                </div>
              )}
              {!frozen && (
                <>
                  <Button className="w-full" disabled={saving} onClick={() => save()}>
                    <Save className="h-4 w-4" /> {saving ? "Enregistrement..." : "Enregistrer"}
                  </Button>
                  {!invoiced && (
                    <Button variant="dark" className="w-full" disabled={saving} onClick={() => save("sent")}>
                      Enregistrer & marquer envoyé
                    </Button>
                  )}
                </>
              )}
              {editId && (
                <Link
                  to={`${listPath}/${editId}/view`}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#f59e0b]/40 px-4 py-2 text-sm text-brand-2 hover:bg-brand-soft"
                >
                  <Printer className="h-4 w-4" /> Aperçu / PDF
                </Link>
              )}
              {editId && !frozen && !invoiced && (
                <Button
                  variant="danger"
                  className="w-full"
                  disabled={deleting}
                  onClick={async () => {
                    if (deleting) return;
                    if (!confirm(isQuote ? "Supprimer ce devis ?" : "Supprimer ce bon de commande ?")) return;
                    setDeleting(true);
                    setError("");
                    try {
                      if (isQuote) await api.deleteQuote(editId);
                      else await api.deleteOrder(editId);
                      navigate(listPath);
                    } catch (e) {
                      /* sans catch : erreur silencieuse et l'utilisateur reclique */
                      setError((e as Error).message);
                      setDeleting(false);
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" /> {deleting ? "Suppression..." : "Supprimer"}
                </Button>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}