import { useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { hasSession } from "../pages/Login";
import Login from "../pages/Login";
import { Spinner } from "./ui";

export default function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"checking" | "app" | "login">("checking");

  useEffect(() => {
    if (hasSession()) {
      setState("app");
      return;
    }
    api
      .getAuthStatus()
      .then((s) => setState(s.configured ? "login" : "app"))
      .catch(() => setState("app"));
  }, []);

  useEffect(() => {
    if (state === "app" && location.pathname === "/login") location.assign("/");
  }, [state]);

  if (state === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app">
        <Spinner />
      </div>
    );
  }
  if (state === "login") return <Login />;
  return <>{children}</>;
}