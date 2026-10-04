import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Modal } from "./ui";

/**
 * Confirmation obligatoire avant toute action irreversible
 * (finalisation de facture, suppression de devis, envoi d'e-mail).
 * L'interface doit transmettre un apercu : le corps exact de l'action.
 */
export function ConfirmModal({
  open,
  title,
  body,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  danger = false,
  busyLabel,
  children,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  /** Apercu lisible de l'action (montants, destinataire, numero...). */
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busyLabel?: string;
  /** Contenu interactif facultatif (ex. champ de confirmation saisie). */
  children?: ReactNode;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) setBusy(false);
  }, [open]);

  if (!open) return null;

  const run = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title={title} onClose={busy ? () => {} : onCancel} width="max-w-lg">
      <div className="space-y-4">
        {danger && (
          <div className="flex gap-3 rounded-lg border border-danger-line bg-danger-soft px-3 py-2.5 text-sm text-danger">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Cette action est définitive.</span>
          </div>
        )}
        <div className="text-sm leading-relaxed text-ink-2">{body}</div>
        {children}
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-line px-4 py-2 text-sm text-ink-3 transition hover:bg-hover disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={run}
            disabled={busy}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-60 ${
              danger ? "bg-danger hover:brightness-110" : "bg-accent text-accent-ink hover:bg-accent-hover"
            }`}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {busy ? busyLabel || "En cours…" : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Confirmation strengthened : l'utilisateur doit recopier un code.
 * Reserve aux actions qui ne doivent jamais se produire par megarde
 * (activation du mode Reel des e-mails, restauration d'une sauvegarde).
 */
export function ConfirmCodeModal({
  open,
  title,
  body,
  expectedCode,
  confirmLabel = "Valider",
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  expectedCode: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);
  if (!open) return null;
  const valid = typed.trim() === expectedCode;
  return (
    <Modal open title={title} onClose={onCancel} width="max-w-lg">
      <div className="space-y-4">
        <div className="text-sm leading-relaxed text-ink-2">{body}</div>
        <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5">
          <div className="text-xs uppercase tracking-wide text-ink-4">
            Recopiez ce code pour confirmer : <code className="font-mono font-semibold text-ink">{expectedCode}</code>
          </div>
          <input
            className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-accent"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={expectedCode}
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <button onClick={onCancel} className="rounded-lg border border-line px-4 py-2 text-sm text-ink-3 hover:bg-hover">
            Annuler
          </button>
          <button
            onClick={() => valid && onConfirm()}
            disabled={!valid}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-40 ${
              danger ? "bg-danger" : "bg-accent text-accent-ink"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}