import { Component, type ReactNode } from "react";

const reload = () => location.reload();

export default class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    if ("caches" in window) caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
    console.error("BOUNDARY", (error as Error)?.stack || (error as Error)?.message);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="text-3xl font-bold text-ink">!</div>
          <div className="font-semibold text-ink">Une erreur est survenue</div>
          <p className="max-w-sm text-sm text-ink-3">
            Un cache de l'ancienne version a peut-être interféré. Le cache a été effacé, rechargez la page.
          </p>
          <button
            onClick={reload}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink hover:bg-accent-hover"
          >
            Recharger la page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}