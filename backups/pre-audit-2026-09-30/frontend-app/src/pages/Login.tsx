import { useState } from "react";
import { api, setSession } from "../lib/api";
import { Lock } from "lucide-react";

export { setSession, getSession as hasSession, clearSession } from "../lib/api";

export default function Login() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
    <div className="flex min-h-screen items-center justify-center bg-[#1c130c] p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src="/logo.png" alt="PaletteD&co" className="h-20 w-20 rounded-2xl object-contain" />
          <h1 className="mt-4 text-xl font-semibold text-white">PaletteD&co</h1>
          <p className="text-sm text-amber-400/80">Devis & Factures</p>
        </div>

        <form onSubmit={submit} className="rounded-2xl border border-white/10 bg-[#251710] p-5">
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-400">Mot de passe</label>
          <input
            type="password"
            autoFocus
            className="w-full rounded-lg border border-white/15 bg-[#271a10] px-3 py-2.5 text-sm text-stone-100 placeholder-stone-500 focus:outline-none"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <div className="mt-2 text-sm text-red-300">{error}</div>}
          <button
            type="submit"
            disabled={!password || busy}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#14b8a6] px-4 py-2.5 text-sm font-semibold text-[#0c1413] shadow transition hover:bg-[#0fb69f] disabled:opacity-50"
          >
            <Lock className="h-4 w-4" /> {busy ? "Connexion..." : "Se connecter"}
          </button>
        </form>
      </div>
    </div>
  );
}