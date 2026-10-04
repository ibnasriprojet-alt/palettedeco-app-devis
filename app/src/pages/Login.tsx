import { useState } from "react";
import { api, setSession } from "../lib/api";
import { Lock } from "lucide-react";

export { setSession, getSession as hasSession, clearSession } from "../lib/api";

export default function Login() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /* Redirigee ici apres un changement de mot de passe : la session precedente
     est devenue invalide, il faut le dire plutot que laisser un ecran muet. */
  const [notice] = useState(
    () => new URLSearchParams(location.search).get("motdepasse") === "change"
      ? "Mot de passe modifié. Reconnectez-vous avec le nouveau."
      : "",
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.login(password);
      if (res.ok && res.session) {
        setSession(res.session);
        location.assign("/");
      } else {
        setError(res.configured ? "Mot de passe incorrect." : "Le mot de passe n'est pas encore configuré dans Réglages.");
      }
    } catch {
      setError("Impossible de contacter le serveur. Vérifiez votre connexion.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-app p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src="/logo.png" alt="PaletteD&co" className="h-20 w-20 rounded-2xl object-contain" />
          <h1 className="mt-4 text-xl font-semibold text-ink">PaletteD&co</h1>
          <p className="text-sm text-brand-2/80">Devis & Factures</p>
        </div>

        <form onSubmit={submit} className="rounded-2xl border border-line bg-surface p-5">
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-3">Mot de passe</label>
          <input
            type="password"
            autoFocus
            className="w-full rounded-lg border border-line-2 bg-surface-2 px-3 py-2.5 text-sm text-ink placeholder-ink-4 focus:outline-none"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {notice && <div className="mt-2 text-sm text-success">{notice}</div>}
          {error && <div className="mt-2 text-sm text-danger">{error}</div>}
          <button
            type="submit"
            disabled={!password || busy}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink shadow transition hover:bg-accent-hover disabled:opacity-50"
          >
            <Lock className="h-4 w-4" /> {busy ? "Connexion..." : "Se connecter"}
          </button>
        </form>
      </div>
    </div>
  );
}