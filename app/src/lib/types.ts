export interface Company {
  id: number;
  name: string;
  owner_name: string;
  siret: string;
  vat_number: string;
  address: string;
  email: string;
  phone: string;
  website: string;
  iban: string;
  bic: string;
  logo: string;
  default_tva_rate: string;
  payment_terms: string;
  mentions: string;
  app_password?: string;
  /* Identifiants legaux (migration 003) */
  legal_name?: string;
  siren?: string;
  rcs?: string;
  legal_form?: string;
  share_capital?: string | null;
  ape?: string;
  address2?: string;
  zip_code?: string;
  city?: string;
  country?: string;
  insurance?: string;
  /* Conditions de reglement */
  default_terms_days?: string | number;
  late_penalty_rate?: string | number;
  recovery_fee?: string | number;
}

export interface Client {
  id: number;
  name: string;
  siret: string;
  vat_number: string;
  address: string;
  email: string;
  phone: string;
  notes: string;
  no_reminders?: boolean;
  created_at?: string;
}

export interface QuoteItem {
  id?: number;
  description: string;
  quantity: number | string;
  unit_price: number | string;
  tva_rate: number | string;
  align?: "left" | "center" | "right";
  bold?: boolean;
  italic?: boolean;
  is_block?: boolean;
}

export type QuoteStatus = "draft" | "sent" | "accepted" | "declined" | "invoiced";
export type OrderStatus = QuoteStatus;
export type InvoiceStatus = "unpaid" | "paid" | "partial";

export interface DocPayload {
  client_id: number | null;
  status: string;
  number: string;
  issue_date: string;
  valid_until: string;
  conditions: string;
  notes: string;
  items: QuoteItem[];
  photos?: string[];
}

export interface Quote {
  id: number;
  number: string;
  client_id: number | null;
  status: QuoteStatus;
  issue_date: string;
  valid_until: string;
  conditions: string;
  notes: string;
  total_ht: string | number;
  total_tva: string | number;
  total_ttc: string | number;
  items: QuoteItem[];
  photos?: string[];
  client?: Client | null;
  synced_invoice_id?: number | null;
  signed?: boolean;
  signed_at?: string | null;
  signed_by?: SignedBy[];
  signature_mention?: string;
}

export interface Signatory {
  id: number;
  name: string;
  role: string;
  image: string;
  active: boolean;
  sort_order: number;
  created_at?: string;
}

export interface SignedBy {
  id: number;
  name: string;
  role: string;
  image: string;
}

export interface Order {
  id: number;
  number: string;
  client_id: number | null;
  status: OrderStatus;
  issue_date: string;
  valid_until: string;
  conditions: string;
  notes: string;
  total_ht: string | number;
  total_tva: string | number;
  total_ttc: string | number;
  items: QuoteItem[];
  photos?: string[];
  client?: Client | null;
  synced_invoice_id?: number | null;
}

export interface InvoiceItem {
  id?: number;
  description: string;
  quantity: number | string;
  unit_price: number | string;
  tva_rate: number | string;
  align?: "left" | "center" | "right";
  bold?: boolean;
  italic?: boolean;
  is_block?: boolean;
}

export interface Payment {
  id: number;
  invoice_id: number;
  amount: string | number;
  method: string;
  date: string;
  note: string;
  created_at?: string;
}

export interface Invoice {
  id: number;
  number: string;
  quote_id: number | null;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string;
  conditions: string;
  notes?: string;
  total_ht: string | number;
  total_tva: string | number;
  total_ttc: string | number;
  items: InvoiceItem[];
  client?: Client | null;
  quote_number?: string | null;
  payments?: Payment[];
  paid?: number;
  remaining?: number;
  finalized?: boolean;
  finalized_at?: string | null;
}

export interface ClientHistory {
  quotes: Array<{ id: number; number: string; status: QuoteStatus; issue_date: string; valid_until: string; total_ttc: number }>;
  orders: Array<{ id: number; number: string; status: OrderStatus; issue_date: string; valid_until: string; total_ttc: number }>;
  invoices: Array<{ id: number; number: string; status: InvoiceStatus; issue_date: string; due_date: string; total_ttc: number; paid: number }>;
}

export interface DocRow {
  id: number;
  number: string;
  status: string;
  total_ttc: string | number;
  paid?: string | number;
  client?: string | null;
  due_date?: string;
  valid_until?: string;
}

export interface Stats {
  quotes: string | number;
  clients: string | number;
  invoices: string | number;
  quotes_value: string | number;
  invoices_value: string | number;
  draft: string | number;
  sent: string | number;
  accepted: string | number;
  declined: string | number;
  invoiced: string | number;
  unpaid: string | number;
  paid: string | number;
  partial: string | number;
  invoices_total?: string | number;
  received_total?: string | number;
  pending_total?: string | number;
  accepted_value?: string | number;
  month_invoiced?: string | number;
  month_count?: string | number;
  payments_total_total?: string | number;
  acceptance_rate?: string | number;
  overdue?: DocRow[];
  expiring_quotes?: DocRow[];
  recent_invoices?: DocRow[];
}