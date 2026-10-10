import type { Client, ClientHistory, Company, Invoice, InvoiceStatus, Order, OrderStatus, Payment, Quote, QuoteStatus, Stats } from "./types";
import type {
  AppSettings, BankAccount, BankTransaction, ComplianceCheck, Expense, ExpenseInput, Kpi,
  ReminderLog, ReminderPreview, ReminderTarget, ReminderTemplate,
} from "./cockpit-types";

declare const __API_URL__: string;

export const BASE = __API_URL__ || "";

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
  const headers: Record<string, string> = {};
  /* Content-Type uniquement s'il y a un corps : sinon chaque GET devient une
     requete "simple" et ne declenche pas de preflight CORS. */
  if (options.body) headers["Content-Type"] = "application/json";
  const sess = getSession();
  if (sess) headers["X-Session"] = sess;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...options, headers });
  } catch {
    throw new Error("Connexion au serveur impossible. Verifiez votre connexion internet.");
  }

  if (res.status === 401 && sess) {
    clearSession();
    try {
      if (location.pathname !== "/login") location.assign("/login");
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
  /* ---------- Cockpit : reglages, depenses, tresorerie, KPI, relances ---------- */
  getSettings: () => request<AppSettings>("/api/settings"),
  saveSettings: (s: Partial<AppSettings> & { confirm_live?: string }) =>
    request<AppSettings>("/api/settings", { method: "PUT", body: JSON.stringify(s) }),

  getExpenses: (p: { from?: string; to?: string; q?: string; category?: string }) => {
    const qs = new URLSearchParams();
    if (p.from) qs.set("from", p.from);
    if (p.to) qs.set("to", p.to);
    if (p.q) qs.set("q", p.q);
    if (p.category) qs.set("category", p.category);
    return request<{ items: Expense[]; total: { count: number; ttc: number | string; ht: number | string; tva: number | string } }>(
      `/api/expenses?${qs}`,
    );
  },
  createExpense: (e: ExpenseInput) =>
    request<Expense>("/api/expenses", { method: "POST", body: JSON.stringify(e) }),
  updateExpense: (id: number, e: ExpenseInput) =>
    request<Expense>(`/api/expenses/${id}`, { method: "PUT", body: JSON.stringify(e) }),
  deleteExpense: (id: number) => request<{ ok: boolean }>(`/api/expenses/${id}`, { method: "DELETE" }),

  getBankAccounts: () => request<{ items: BankAccount[] }>("/api/bank-accounts"),
  createBankAccount: (b: Partial<BankAccount>) =>
    request<BankAccount>("/api/bank-accounts", { method: "POST", body: JSON.stringify(b) }),
  updateBankAccount: (id: number, b: Partial<BankAccount>) =>
    request<BankAccount>(`/api/bank-accounts/${id}`, { method: "PUT", body: JSON.stringify(b) }),

  getTransactions: (p: { from?: string; to?: string; account_id?: number }) => {
    const qs = new URLSearchParams();
    if (p.from) qs.set("from", p.from);
    if (p.to) qs.set("to", p.to);
    if (p.account_id) qs.set("account_id", String(p.account_id));
    return request<{ items: BankTransaction[]; total: { entries: number | string; exits: number | string } }>(
      `/api/transactions?${qs}`,
    );
  },
  createTransaction: (t: Partial<BankTransaction>) =>
    request<BankTransaction>("/api/transactions", { method: "POST", body: JSON.stringify(t) }),
  deleteTransaction: (id: number) =>
    request<{ ok: boolean }>(`/api/transactions/${id}`, { method: "DELETE" }),

  getCash: (p: { from?: string; to?: string }) => {
    const qs = new URLSearchParams();
    if (p.from) qs.set("from", p.from);
    if (p.to) qs.set("to", p.to);
    return request<{ accounts: BankAccount[]; total: number | string; has_accounts: boolean }>(`/api/cash?${qs}`);
  },

  getKpi: (p: { from?: string; to?: string; prev_from?: string; prev_to?: string }) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) if (v) qs.set(k, String(v));
    return request<Kpi>(`/api/kpi?${qs}`);
  },

  getReminderTemplates: () => request<{ items: ReminderTemplate[] }>("/api/reminder-templates"),
  saveReminderTemplate: (id: number, t: Partial<ReminderTemplate>) =>
    request<ReminderTemplate>(`/api/reminder-templates/${id}`, { method: "PUT", body: JSON.stringify(t) }),
  getRemindersDue: () =>
    request<{ items: ReminderTarget[]; templates: ReminderTemplate[]; mode: "test" | "live" }>("/api/reminders/due"),
  previewReminder: (invoice_id: number, level: number) =>
    request<ReminderPreview>("/api/reminders/preview", { method: "POST", body: JSON.stringify({ invoice_id, level }) }),
  sendReminder: (invoice_id: number, level: number, channel?: string) =>
    request<{ ok: boolean; redirected: boolean; mode: string; to: string; reste: number }>("/api/reminders/send", {
      method: "POST",
      body: JSON.stringify({ invoice_id, level, channel }),
    }),
  sendRemindersBatch: (invoice_ids: number[]) =>
    request<{ ok: boolean; sent: number; failed: number; results: { ok: boolean; invoice_id: number; error?: string }[] }>(
      "/api/reminders/send-batch",
      { method: "POST", body: JSON.stringify({ invoice_ids }) },
    ),
  getReminderLog: (invoice_id?: number) =>
    request<{ items: ReminderLog[] }>(`/api/reminders${invoice_id ? `?invoice_id=${invoice_id}` : ""}`),

  getInvoiceCompliance: (id: number) =>
    request<{ invoice: Record<string, unknown>; checks: ComplianceCheck[]; ready: boolean }>(`/api/invoices/${id}/compliance`),
  finalizeInvoice: (id: number) => request<{ id: number }>(`/api/invoices/${id}/finalize`, { method: "POST" }),

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
  acceptPublicQuote: (id: number, sig: string, email?: string) =>
    request<{ ok: boolean; already?: boolean; number?: string; email_sent?: boolean; redirected?: boolean; mode?: string; email_error?: string; email_required?: boolean }>(
      `/api/public/quote/${id}/accept`,
      { method: "POST", body: JSON.stringify({ sig, email }) },
    ),

  sendDocument: (type: "quote" | "invoice" | "order", id: number, to: string, copy = false) =>
    request<{ ok: boolean }>("/api/send-document", { method: "POST", body: JSON.stringify({ type, id, to, copy }) }),

  getPublicPdfUrl: (type: "quote" | "invoice" | "order", id: number) =>
    request<{ url: string }>(`/api/pdf-url/${type}/${id}`),

  downloadPdf: async (type: "quote" | "invoice" | "order", id: number, number?: string): Promise<{ url: string; filename: string }> => {
    const sess = getSession();
    const headers: Record<string, string> = {};
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
  draft: "bg-surface-3 text-ink-2 border-line-2",
  sent: "bg-brand-soft text-brand-2 border-brand-line",
  accepted: "bg-success-soft text-success border-success-line",
  declined: "bg-danger-soft text-danger border-danger-line",
  invoiced: "bg-violet-500/15 text-violet-300 border-violet-500/40",
  unpaid: "bg-danger-soft text-danger border-danger-line",
  paid: "bg-success-soft text-success border-success-line",
  partial: "bg-brand-soft text-brand-2 border-brand-line",
};