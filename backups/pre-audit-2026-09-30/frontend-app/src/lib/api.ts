import type { Client, ClientHistory, Company, Invoice, InvoiceStatus, Order, OrderStatus, Payment, Quote, QuoteStatus, Stats } from "./types";

declare const __API_URL__: string;
declare const __API_TOKEN__: string;

export const BASE = __API_URL__ || "";
const TOKEN = __API_TOKEN__ || "";

export const SESSION_KEY = "palette_session";

export function getSession(): string {
  try {
    return localStorage.getItem(SESSION_KEY) || "";
  } catch {
    return "";
  }
}
export function setSession(token: string) {
  try {
    localStorage.setItem(SESSION_KEY, token);
  } catch {
    /* ignore */
  }
}
export function hasSession(): boolean {
  return !!getSession();
}
export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const sess = getSession();
  if (TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;
  if (sess) headers["X-Session"] = sess;

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (res.status === 401 && sess) {
    clearSession();
    try {
      if (location.pathname !== "/login") location.reload();
    } catch {
      /* ignore */
    }
  }

  if (!res.ok) {
    let msg = `Erreur ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) msg = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  getAuthStatus: () => request<{ configured: boolean }>("/api/auth/status"),
  login: (password: string) =>
    request<{ ok: boolean; configured: boolean; session?: string }>("/api/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),

  getCompany: () => request<Company>("/api/company"),
  saveCompany: (c: Partial<Company>) => request<Company>("/api/company", { method: "PUT", body: JSON.stringify(c) }),

  getClients: () => request<Client[]>("/api/clients"),
  createClient: (c: Partial<Client>) => request<Client>("/api/clients", { method: "POST", body: JSON.stringify(c) }),
  updateClient: (id: number, c: Partial<Client>) =>
    request<Client>(`/api/clients/${id}`, { method: "PUT", body: JSON.stringify(c) }),
  deleteClient: (id: number) => request<{ ok: boolean }>(`/api/clients/${id}`, { method: "DELETE" }),
  getClientHistory: (id: number) => request<ClientHistory>(`/api/clients/${id}/history`),

  getQuotes: (status?: string) => request<Quote[]>(`/api/quotes${status ? `?status=${status}` : ""}`),
  getQuote: (id: number) => request<Quote>(`/api/quotes/${id}`),
  createQuote: (q: Partial<Quote>) => request<Quote>("/api/quotes", { method: "POST", body: JSON.stringify(q) }),
  updateQuote: (id: number, q: Partial<Quote>) =>
    request<Quote>(`/api/quotes/${id}`, { method: "PUT", body: JSON.stringify(q) }),
  setQuoteStatus: (id: number, status: QuoteStatus) =>
    request<Quote>(`/api/quotes/${id}/status`, { method: "POST", body: JSON.stringify({ status }) }),
  deleteQuote: (id: number) => request<{ ok: boolean }>(`/api/quotes/${id}`, { method: "DELETE" }),
  convertQuote: (id: number, number?: string) =>
    request<Invoice>(`/api/quotes/${id}/convert`, { method: "POST", body: JSON.stringify({ number: number || "" }) }),
  shareQuote: (id: number) => request<{ id: number; number: string; sig: string }>(`/api/quotes/${id}/share`),

  getOrders: () => request<Order[]>(`/api/orders`),
  getOrder: (id: number) => request<Order>(`/api/orders/${id}`),
  createOrder: (o: Partial<Order>) => request<Order>("/api/orders", { method: "POST", body: JSON.stringify(o) }),
  updateOrder: (id: number, o: Partial<Order>) =>
    request<Order>(`/api/orders/${id}`, { method: "PUT", body: JSON.stringify(o) }),
  setOrderStatus: (id: number, status: OrderStatus) =>
    request<Order>(`/api/orders/${id}/status`, { method: "POST", body: JSON.stringify({ status }) }),
  deleteOrder: (id: number) => request<{ ok: boolean }>(`/api/orders/${id}`, { method: "DELETE" }),
  convertOrder: (id: number, number?: string) =>
    request<Invoice>(`/api/orders/${id}/convert`, { method: "POST", body: JSON.stringify({ number: number || "" }) }),

  getInvoices: () => request<Invoice[]>("/api/invoices"),
  getInvoice: (id: number) => request<Invoice>(`/api/invoices/${id}`),
  setInvoiceStatus: (id: number, status: InvoiceStatus) =>
    request<Invoice>(`/api/invoices/${id}/status`, { method: "POST", body: JSON.stringify({ status }) }),
  deleteInvoice: (id: number) => request<{ ok: boolean }>(`/api/invoices/${id}`, { method: "DELETE" }),
  addPayment: (id: number, p: { amount: string | number; method: string; date: string; note: string }) =>
    request<{ payment: Payment; status: InvoiceStatus; paid: number; remaining: number }>(
      `/api/invoices/${id}/payments`,
      { method: "POST", body: JSON.stringify(p) },
    ),
  deletePayment: (id: number, pid: number) => request<Invoice>(`/api/invoices/${id}/payments/${pid}`, { method: "DELETE" }),

  getStats: () => request<Stats>("/api/stats"),
  getBackup: () => request<any>("/api/backup"),
  restoreBackup: (data: any) =>
    request<{ ok: boolean }>("/api/backup/restore", { method: "POST", body: JSON.stringify({ data }) }),

  getPublicQuote: (id: number, sig: string) =>
    request<any>(`/api/public/quote/${id}/info?sig=${encodeURIComponent(sig)}`),
  acceptPublicQuote: (id: number, sig: string) =>
    request<{ ok: boolean; already?: boolean; number?: string }>(`/api/public/quote/${id}/accept`, {
      method: "POST",
      body: JSON.stringify({ sig }),
    }),

  sendDocument: (type: "quote" | "invoice" | "order", id: number, to: string, copy = false) =>
    request<{ ok: boolean }>("/api/send-document", { method: "POST", body: JSON.stringify({ type, id, to, copy }) }),

  getPublicPdfUrl: (type: "quote" | "invoice" | "order", id: number) =>
    request<{ url: string }>(`/api/pdf-url/${type}/${id}`),

  downloadPdf: async (type: "quote" | "invoice" | "order", id: number, number?: string): Promise<{ url: string; filename: string }> => {
    const sess = getSession();
    const headers: Record<string, string> = {};
    if (TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;
    if (sess) headers["X-Session"] = sess;
    const res = await fetch(`${BASE}/api/pdf/${type}/${id}`, { headers });
    if (!res.ok) {
      let msg = `Erreur ${res.status}`;
      try {
        const data = await res.json();
        if (data?.error) msg = data.error;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }
    const disposition = res.headers.get("Content-Disposition") || "";
    const m = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
    const label = type === "invoice" ? "Facture" : type === "order" ? "Bon-de-commande" : "Devis";
    const fallback = number ? `${label} ${number}` : `${type}-${id}`;
    const blob = await res.blob();
    const name = (m?.[1] || fallback).trim();
    return { url: URL.createObjectURL(blob), filename: /\.pdf$/i.test(name) ? name : `${name}.pdf` };
  },
};

export const statusLabels: Record<string, string> = {
  draft: "Brouillon",
  sent: "Envoyé",
  accepted: "Accepté",
  declined: "Refusé",
  invoiced: "Facturé",
  unpaid: "Impagée",
  paid: "Payée",
  partial: "Partielle",
};

export const statusColors: Record<string, string> = {
  draft: "bg-stone-600/30 text-stone-300 border-stone-500/40",
  sent: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  accepted: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  declined: "bg-red-500/15 text-red-300 border-red-500/40",
  invoiced: "bg-violet-500/15 text-violet-300 border-violet-500/40",
  unpaid: "bg-red-500/15 text-red-300 border-red-500/40",
  paid: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  partial: "bg-amber-500/15 text-amber-300 border-amber-500/40",
};