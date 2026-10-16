import { Hono } from "hono";
import pg from "pg";
import { attachDatabasePool } from "@neon/functions";
import PDFDocument from "pdfkit";
import { registerCockpit } from "./cockpit.js";
import { syncPaymentTransaction, removePaymentTransaction } from "./bank-sync.js";
import { loadAppSettings, resolveRecipient } from "./settings.js";
import { buildFacturxXml, facturxXmp } from "./facturx.js";

pg.types.setTypeParser(1082, (v) => v);

const { Pool, Client } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});
attachDatabasePool(pool);

const API_TOKEN = process.env.API_TOKEN || "";
const SESSION_SECRET = process.env.SESSION_SECRET || API_TOKEN || randomHex(32);
const PDF_SECRET = process.env.PDF_SECRET || SESSION_SECRET;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://palette-devis.vercel.app";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const BREVO_API_KEY = process.env.BREVO_API_KEY || "";
const EMAIL_FROM = process.env.EMAIL_FROM || `PaletteD&co <devis@${new URL(ALLOWED_ORIGIN).hostname.replace("www.", "")}>`;

/* "/health" doit rester public : une sonde de supervision qui repond 401 est
   inexploitable. Ne renvoie que { ok: true }, aucune donnee metier. */
const PUBLIC_PREFIXES = ["/api/login", "/api/auth/status", "/api/public/", "/api/pdf-share/", "/health"];

const enc = new TextEncoder();

function randomHex(bytes = 16) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacHex(keyStr, msg) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(keyStr),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-256" },
    key,
    256,
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function storedPassword(plain) {
  const salt = randomHex();
  return `pbkdf2$${salt}$${await hashPassword(plain, salt)}`;
}

async function verifyPassword(plain, stored) {
  const [algo, salt, hash] = String(stored || "").split("$");
  if (algo !== "pbkdf2" || !salt || !hash) return false;
  return (await hashPassword(plain, salt)) === hash;
}

/* ---------- Anti force-brute (mémoire) ---------- */
const failMap = new Map();
function rateKey(c) {
  return `${c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "local"}`;
}
function isBlocked(key) {
  const rec = failMap.get(key);
  if (!rec) return false;
  if (Date.now() - rec.last > 10 * 60 * 1000) {
    failMap.delete(key);
    return false;
  }
  return rec.count >= 5;
}
function noteFailure(key) {
  const rec = failMap.get(key) || { count: 0, last: 0 };
  rec.count += 1;
  rec.last = Date.now();
  failMap.set(key, rec);
}
function resetFailures(key) {
  failMap.delete(key);
}

function applyCors(c) {
  if (!c.res) return;
  c.res.headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  c.res.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  c.res.headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Api-Key,X-Session");
  c.res.headers.set("Access-Control-Expose-Headers", "Content-Disposition,Content-Length");
  c.res.headers.set("Vary", "Origin");
}

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function defaultValidFrom(issueDate) {
  const d = issueDate ? new Date(`${issueDate}T00:00:00`) : new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

async function loadCompany(withSecret = false) {
  const { rows } = await pool.query("SELECT * FROM company WHERE id = 1");
  const row = rows[0] || null;
  if (row && !withSecret) delete row.app_password;
  return row;
}

async function sessionValid(c) {
  const company = await loadCompany(true);
  if (!company || !company.app_password) return true;
  const auth = c.req.header("authorization") || "";
  const keyh = c.req.header("x-api-key") || "";
  if (API_TOKEN && (auth === `Bearer ${API_TOKEN}` || keyh === API_TOKEN)) return true;
  const sess = c.req.header("x-session") || "";
  if (!sess) return false;
  const expected = await hmacHex(SESSION_SECRET, `session:${company.app_password}`);
  return timingSafeEqual(sess, expected);
}

async function sessionToken() {
  const company = await loadCompany(true);
  if (!company || !company.app_password) return "";
  return hmacHex(SESSION_SECRET, `session:${company.app_password}`);
}

function computeTotals(items) {
  const totals = { total_ht: 0, total_tva: 0, total_ttc: 0, byRate: {} };
  for (const it of items) {
    const qty = Number(it.quantity) || 0;
    const unit = Number(it.unit_price) || 0;
    const rate = Number(it.tva_rate) || 0;
    const ht = money(qty * unit);
    const tva = money(ht * (rate / 100));
    totals.total_ht = money(totals.total_ht + ht);
    totals.total_tva = money(totals.total_tva + tva);
    totals.total_ttc = money(totals.total_ttc + ht + tva);
    const key = String(rate);
    totals.byRate[key] = totals.byRate[key] || { rate, base: 0, tva: 0 };
    totals.byRate[key].base = money(totals.byRate[key].base + ht);
    totals.byRate[key].tva = money(totals.byRate[key].tva + tva);
  }
  totals.total_ht = money(totals.total_ht);
  totals.total_tva = money(totals.total_tva);
  totals.total_ttc = money(totals.total_ttc);
  return totals;
}

/* Numérotation continue : le prochain numéro suit le plus grand numéro
   existant pour l'année. Un document supprimé libère son numéro (pas de trou),
   un numéro personnalisé saisi plus haut relève automatiquement la suite. */
async function autoNext(client, table, prefix, year) {
  const pattern = `^${prefix.toUpperCase()}-${year}-[0-9]+$`;
  const { rows } = await client.query(
    `SELECT number FROM ${table} WHERE number ~ $1`,
    [pattern],
  );
  let max = 0;
  for (const r of rows) {
    const m = String(r.number).match(/-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix.toUpperCase()}-${year}-${String(max + 1).padStart(3, "0")}`;
}

async function numberInUse(client, table, number, excludeId) {
  const { rows } = await client.query(
    `SELECT 1 FROM ${table} WHERE number = $1 AND ($2::int IS NULL OR id <> $2) LIMIT 1`,
    [number, excludeId ?? null],
  );
  return rows.length > 0;
}

function itemProps(it) {
  return {
    description: String(it.description || ""),
    quantity: Number(it.quantity) || 0,
    unit_price: Number(it.unit_price) || 0,
    tva_rate: Number(it.tva_rate) || 0,
    align: ["left", "center", "right"].includes(String(it.align)) ? it.align : "left",
    bold: !!it.bold,
    italic: !!it.italic,
    is_block: !!it.is_block,
  };
}

function normalizePhotos(photos) {
  if (!Array.isArray(photos)) return [];
  return photos
    .filter((p) => typeof p === "string" && /^data:image\/(png|jpe?g|webp);base64,/.test(p) && p.length < 3_000_000)
    .slice(0, 6);
}

async function syncInvoiceFromSource(client, sourceTable, sourceId, items, totals, conditions, photos) {
  const invCol = sourceTable === "orders" ? "order_id" : "quote_id";
  const { rows } = await client.query(`SELECT id FROM invoices WHERE ${invCol} = $1 ORDER BY id LIMIT 1`, [sourceId]);
  if (!rows[0]) return null;
  const invId = rows[0].id;
  await client.query(
    "UPDATE invoices SET conditions = $1, total_ht = $2, total_tva = $3, total_ttc = $4, photos = $5::jsonb, updated_at = now() WHERE id = $6",
    [conditions || "", totals.total_ht, totals.total_tva, totals.total_ttc, JSON.stringify(photos), invId],
  );
  await client.query("DELETE FROM invoice_items WHERE invoice_id = $1", [invId]);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    await client.query(
      `INSERT INTO invoice_items (invoice_id, position, description, quantity, unit_price, tva_rate, align, bold, italic, is_block)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [invId, i, it.description, it.quantity, it.unit_price, it.tva_rate, it.align, it.bold, it.italic, it.is_block],
    );
  }
  const paidRow = (await client.query("SELECT coalesce(sum(amount),0) AS paid FROM payments WHERE invoice_id = $1", [invId])).rows[0];
  const paid = Number(paidRow.paid || 0);
  if (paid > 0) {
    const nextStatus = paid + 0.005 >= Number(totals.total_ttc) ? "paid" : "partial";
    await client.query("UPDATE invoices SET status = $1 WHERE id = $2", [nextStatus, invId]);
  }
  return invId;
}

async function listPayments(invoiceId) {
  const { rows } = await pool.query(
    "SELECT * FROM payments WHERE invoice_id = $1 ORDER BY date DESC, id DESC",
    [invoiceId],
  );
  return rows;
}

function moneyStr(n) {
  /* PDFKit mesure l'espace fine insécable (U+202F) à 0 pt alors qu'elle est rendue :
     on la remplace par une insécable classique (U+00A0), correctement mesurée, sinon
     les montants alignés à droite débordent de la colonne. */
  return `${Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\u202f/g, "\u00a0")} €`;
}

function pdfFilename(doc, type, id) {
  const label = type === "invoice" ? "Facture" : type === "order" ? "Bon-de-commande" : "Devis";
  const number = String((doc && doc.number) || "").trim() || `${type}-${id}`;
  return `${label} ${number}`.replace(/["\\/\r\n]/g, "-") + ".pdf";
}
function dateFr(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-");
  return `${d}/${m}/${y}`;
}

/* ---------- Génération PDF (pdfkit) ---------- */
async function buildDocumentPdf(type, id) {
  const doc = await getDoc(type, id);
  if (!doc) return null;
  const company = await loadCompany(true);
  const isQuote = type === "quote";
  const title = type === "invoice" ? "FACTURE" : type === "order" ? "BON DE COMMANDE" : "DEVIS";

  return await new Promise<Buffer>(async (resolve, reject) => {
    const chunks: Buffer[] = [];
    const pdf = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: false, bufferPages: true });
    pdf.on("data", (c) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);

    pdf.addPage();
    const pageW = pdf.page.width;
    const M = 42;
    const right = pageW - M;
    const ink = "#3c1f0c";
    const teal = "#0f766e";
    const gray = "#6b7280";
    const band = "#dddddd";

    const ensureY = (needed) => {
      if (pdf.y + needed > pdf.page.height - 45) {
        pdf.addPage();
        pdf.y = M;
      }
    };

    pdf.fillColor(ink);

    /* En-tête entreprise */
    let logoW = 0;
    if (company.logo && String(company.logo).startsWith("data:image")) {
      try {
        pdf.image(company.logo, M, 38, { fit: [46, 46] });
        logoW = 46 + 10;
      } catch {
        logoW = 0;
      }
    }
    pdf.font("Helvetica-Bold").fontSize(16).fillColor(ink).text(company.name || "PaletteD&co", M + logoW, 38, { width: 330 });
    pdf.font("Helvetica").fontSize(8.5).fillColor(gray);
    const compLines = [
      company.owner_name ? `Gérant : ${company.owner_name}` : "",
      company.address || "",
      company.email || "",
      company.phone || "",
      company.siret ? `SIRET : ${company.siret}` : "",
      company.vat_number ? `TVA intracommunautaire : ${company.vat_number}` : "",
    ].filter(Boolean);
    let yc = 38 + 18;
    for (const line of compLines) {
      pdf.text(line, M + logoW, yc, { width: 330 });
      yc += 11;
    }

    /* Titre + numéro à droite */
    pdf.font("Helvetica-Bold").fontSize(22).fillColor(isQuote || type === "order" ? teal : ink);
    pdf.text(title, right - 150, 38, { width: 150, align: "right" });
    pdf.font("Helvetica-Bold").fontSize(11).fillColor(ink);
    pdf.text(doc.number, right - 150, 64, { width: 150, align: "right" });
    pdf.font("Helvetica").fontSize(8.5).fillColor(gray);
    pdf.text(`Émis le ${dateFr(doc.issue_date)}`, right - 150, 80, { width: 150, align: "right" });
    pdf.text(
      isQuote ? `Valide jusqu'au ${dateFr(doc.valid_until)}`
      : type === "order" ? `Livraison prévue le ${dateFr(doc.valid_until)}`
      : `Échue le ${dateFr(doc.due_date)}`,
      right - 150,
      92,
      { width: 150, align: "right" },
    );

    /* Client */
    pdf.y = Math.max(130, yc + 8);
    pdf.strokeColor("#d6d3d1").lineWidth(0.7).moveTo(M, pdf.y).lineTo(right, pdf.y).stroke();
    pdf.y += 14;
    pdf.font("Helvetica-Bold").fontSize(7.5).fillColor(gray).text("CLIENT", M, pdf.y);
    pdf.y += 9;
    pdf.font("Helvetica-Bold").fontSize(11).fillColor(ink).text(doc.client?.name || "—", M, pdf.y);
    pdf.y += 12;
    pdf.font("Helvetica").fontSize(8.5).fillColor(ink);
    const cliLines = [
      doc.client?.address || "",
      doc.client?.email || "",
      doc.client?.phone || "",
      doc.client?.siret ? `SIRET : ${doc.client.siret}` : "",
      doc.client?.vat_number ? `TVA intracommunautaire : ${doc.client.vat_number}` : "",
    ].filter(Boolean);
    for (const line of cliLines) pdf.text(line, M, pdf.y);
    pdf.y += 20;

    /* Photos de réalisation */
    if (Array.isArray(doc.photos) && doc.photos.length) {
      const slotW = 140;
      const slotH = 105;
      const gap = 10;
      const perRow = Math.max(1, Math.floor((right - M + gap) / (slotW + gap)));
      pdf.y += 8;
      ensureY(8 + 12 + Math.ceil(Math.min(doc.photos.length, perRow * 3) / perRow) * (slotH + gap) + 12);
      pdf.font("Helvetica-Bold").fontSize(7.5).fillColor(gray).text("PHOTOS DE RÉALISATION", M, pdf.y);
      pdf.y += 12;
      let px = M;
      let py = pdf.y;
      let placed = 0;
      for (const photo of doc.photos) {
        if (typeof photo !== "string" || !photo.startsWith("data:image")) continue;
        if (placed > 0 && placed % perRow === 0) {
          px = M;
          py += slotH + gap;
        }
        try {
          pdf.image(photo, px, py, { fit: [slotW, slotH], align: "center", valign: "center" });
        } catch {
          /* image illisible : on ignore */
        }
        px += slotW + gap;
        placed++;
      }
      pdf.y = py + slotH + 12;
    }

    /* Tableau */
    const cols = [
      { x: M, w: 236, header: "Désignation" },
      { x: M + 236, w: 52, header: "Qté" },
      { x: M + 288, w: 82, header: "Prix HT" },
      { x: M + 370, w: 50, header: "TVA" },
      { x: M + 420, w: right - (M + 420), header: "Total HT" },
    ];
    const drawTableHeader = () => {
      const hy = pdf.y;
      pdf.rect(M, hy, pageW - 2 * M, 20).fill(band);
      pdf.fillColor(ink).font("Helvetica-Bold").fontSize(7.5);
      for (const c of cols) {
        pdf.text(c.header, c.x + 5, hy + 6, { width: c.w - 10, align: c.header === "Désignation" ? "left" : "right" });
      }
      pdf.y = hy + 20;
    };
    drawTableHeader();
    pdf.font("Helvetica").fontSize(9);
    for (const it of doc.items || []) {
      const bold = !!it.bold;
      const italic = !!it.italic;
      const fontFam = italic ? (bold ? "Helvetica-BoldOblique" : "Helvetica-Oblique") : bold ? "Helvetica-Bold" : "Helvetica";
      const align = ["center", "right", "left"].includes(String(it.align)) ? it.align : "left";
      if (it.is_block) {
        const w = right - M - 8;
        const descH = pdf.heightOfString(it.description || "", { width: w });
        const rowH = Math.max(18, descH + 12);
        ensureY(rowH + 6);
        const baseY = pdf.y;
        if (bold) {
          pdf.rect(M, baseY - 2, pageW - 2 * M, rowH).fill(band);
          pdf.fillColor(ink).font(fontFam).fontSize(9.5);
        } else {
          pdf.fillColor(ink).font(fontFam).fontSize(9);
        }
        pdf.text(it.description || "", M + 4, baseY + 4, { width: w - 8, align });
        pdf.y = baseY + rowH;
        pdf.strokeColor("#e7e5e4").lineWidth(0.5).moveTo(M, pdf.y).lineTo(right, pdf.y).stroke();
        pdf.y += 2;
        continue;
      }
      const descH = pdf.heightOfString(it.description || "—", { width: cols[0].w - 10, align });
      const rowH = Math.max(18, descH + 8);
      ensureY(rowH + 6);
      const baseY = pdf.y;
      pdf.font(fontFam).fontSize(9).fillColor(ink);
      pdf.text(it.description || "—", cols[0].x + 5, baseY + 4, { width: cols[0].w - 10, align });
      pdf.font("Helvetica").fontSize(9);
      const cells = [
        { x: cols[1], v: String(Number(it.quantity)), al: "right" },
        { x: cols[2], v: moneyStr(it.unit_price), al: "right" },
        { x: cols[3], v: `${Number(it.tva_rate) || 0} %`, al: "right" },
        { x: cols[4], v: moneyStr(money(Number(it.quantity) * Number(it.unit_price))), al: "right" },
      ];
      for (const cell of cells) {
        pdf.text(cell.v, cell.x.x + 5, baseY + 4, { width: cell.x.w - 10, align: cell.al });
      }
      pdf.y = baseY + rowH;
      pdf.strokeColor("#e7e5e4").lineWidth(0.5).moveTo(M, pdf.y).lineTo(right, pdf.y).stroke();
      pdf.y += 2;
    }

    /* Totaux */
    const byRate: any[] = Object.values(doc.byRate || {}).filter((r: any) => Number(r.base) > 0);
    const totals = byRate.length ? byRate : [{ rate: 0, base: doc.total_ht }];
    let sumTva = 0;
    for (const r of totals) sumTva += Number(r.base || 0) * ((Number(r.rate) || 0) / 100);
    const totW = 185;
    const totX = right - totW;
    ensureY(18 * (totals.length + 3) + 14);
    pdf.y += 6;
    let ty = pdf.y;
    pdf.font("Helvetica").fontSize(8.5).fillColor(gray);
    for (const r of totals) {
      pdf.text(`Base HT ${Number(r.rate) || 0} %`, totX, ty);
      pdf.text(moneyStr(r.base), totX, ty, { width: totW, align: "right" });
      ty += 13;
    }
    pdf.text("Total HT", totX, ty);
    pdf.font("Helvetica-Bold").fillColor(ink);
    pdf.text(moneyStr(doc.total_ht), totX, ty, { width: totW, align: "right" });
    ty += 13;
    pdf.font("Helvetica").fillColor(gray);
    pdf.text("TVA", totX, ty);
    pdf.text(moneyStr(doc.total_tva), totX, ty, { width: totW, align: "right" });
    ty += 15;
    pdf.rect(totX, ty - 3, totW, 24).fill(band);
    pdf.font("Helvetica-Bold").fontSize(9).fillColor(ink);
    pdf.text("Total TTC", totX + 8, ty + 7);
    pdf.font("Helvetica-Bold").fontSize(11).fillColor(teal);
    pdf.text(moneyStr(doc.total_ttc), totX + 8, ty + 7, { width: totW - 16, align: "right" });
    pdf.y = ty + 24;

    /* Paiements (facture) */
    if (!isQuote && doc.payments && doc.payments.length) {
      pdf.y += 16;
      const paid = doc.paid || 0;
      ensureY(20 * (doc.payments.length + 2));
      pdf.font("Helvetica-Bold").fontSize(8).fillColor(gray).text("RÈGLEMENTS ENREGISTRÉS", M, pdf.y);
      pdf.y += 9;
      pdf.font("Helvetica").fontSize(8.5).fillColor(ink);
      for (const p of doc.payments) {
        const py = pdf.y;
        pdf.text(`${dateFr(p.date)} — ${p.method || ""} ${p.note ? "— " + p.note : ""}`.trim(), M, py, { width: 300 });
        pdf.text(moneyStr(p.amount), right - 140, py, { width: 140, align: "right" });
        pdf.y += 13;
      }
      pdf.font("Helvetica-Bold").fontSize(8.5).fillColor(ink);
      const ry = pdf.y;
      pdf.text("Reste à payer", M, ry);
      pdf.text(moneyStr(doc.remaining), right - 140, ry, { width: 140, align: "right" });
    }

    /* Règlement (IBAN) : affiché avant les conditions de règlement. */
    if (company.iban) {
      pdf.y += 22;
      pdf.font("Helvetica-Bold").fontSize(7.5).fillColor(gray).text("RÈGLEMENT", M, pdf.y);
      pdf.y += 10;
      pdf.font("Helvetica").fontSize(8.5).fillColor(ink);
      pdf.text(`IBAN : ${company.iban}${company.bic ? `  ·  BIC : ${company.bic}` : ""}`, M, pdf.y);
    }

    /* Conditions / notes / mentions : en dessous du règlement */
    if (doc.conditions || doc.notes || company.mentions) {
      pdf.y += 24;
      pdf.font("Helvetica-Bold").fontSize(7.5).fillColor(gray).text("CONDITIONS DE RÈGLEMENT", M, pdf.y);
      pdf.y += 10;
      pdf.font("Helvetica").fontSize(8).fillColor(gray);
      if (doc.conditions) {
        pdf.text(doc.conditions, M, pdf.y, { width: pageW - 2 * M, lineGap: 4 });
        pdf.y += 4;
      }
      if (doc.notes) pdf.text(doc.notes, M, pdf.y, { width: pageW - 2 * M });
      if (company.mentions) pdf.text(company.mentions, M, pdf.y, { width: pageW - 2 * M });
    }

    /* Signatures : devis signe par le client et l'entreprise. */
    if (isQuote && doc.signed) {
      const sigs = Array.isArray(doc.signed_by) ? doc.signed_by : [];
      const boxW = 150;
      const boxH = 52;
      const gap = 20;
      const mention = doc.signature_mention || "";
      pdf.y += 26;
      ensureY(80);
      pdf.font("Helvetica-Bold").fontSize(7.5).fillColor(gray).text("SIGNATURES", M, pdf.y);
      pdf.y += 11;
      if (mention) {
        pdf.font("Helvetica-Oblique").fontSize(8).fillColor(gray);
        const mh = pdf.heightOfString(mention, { width: pageW - 2 * M, lineGap: 3 });
        pdf.text(mention, M, pdf.y, { width: pageW - 2 * M, lineGap: 3 });
        pdf.y += mh + 3;
      }
      if (doc.signed_at) {
        pdf.font("Helvetica").fontSize(8).fillColor(gray).text(`Signé le ${dateFr(String(doc.signed_at).slice(0, 10))}`, M, pdf.y);
        pdf.y += 12;
      }
      let col = 0;
      let baseY = pdf.y;
      for (const s of sigs) {
        if (col === 0) {
          ensureY(boxH + 36);
          baseY = pdf.y;
        }
        const x = M + col * (boxW + gap);
        if (s.image && String(s.image).startsWith("data:image")) {
          try {
            pdf.image(s.image, x, baseY, { fit: [boxW, boxH] });
          } catch {
            /* image illisible : on garde la ligne signee */
          }
        }
        const lineY = baseY + boxH + 2;
        pdf.strokeColor("#d6d3d1").lineWidth(0.6).moveTo(x, lineY).lineTo(x + boxW, lineY).stroke();
        pdf.font("Helvetica-Bold").fontSize(8).fillColor(ink).text(s.name || "", x, lineY + 3, { width: boxW });
        if (s.role) pdf.font("Helvetica").fontSize(7).fillColor(gray).text(s.role, x, lineY + 13, { width: boxW });
        col++;
        if (col >= 3) {
          col = 0;
          pdf.y = baseY + boxH + 36;
        }
      }
      if (col !== 0) pdf.y = baseY + boxH + 36;
    }

        /* Factur-X : XML de facture rattache au PDF des factures. */
    if (type === "invoice") {
      try {
        const fxXml = await buildInvoiceFacturx(id, company);
        if (fxXml) {
          /* pdfkit expose doc.file() (et non doc.attach() : reserve a d'autres
             versions). AFRelationship=Data est le marqueur PDF/A-3. */
          (pdf as any).file(Buffer.from(fxXml, "utf8"), {
            name: `facturx-${doc.number}.xml`,
            description: "Facture electronique Factur-X BASIC WL (XML)",
            relationship: "Data",
            type: "text/xml",
          });
          try {
            (pdf as any).XMPMetadata = Buffer.from(facturxXmp(doc.number), "utf8");
          } catch {
            /* XMP refuse par cette version de pdfkit : le PDF reste valide, sans XMP. */
          }
        }
      } catch (err) {
        console.error("[facturx] rattachement XML impossible :", err?.message || err);
      }
    }

    pdf.end();
  });
}

/** Construit le XML Factur-X d'une facture a partir du document deja charge. */
async function buildInvoiceFacturx(id, company): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT i.*, coalesce((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id = i.id),0) AS paid,
            cl.name AS client_name, cl.email AS client_email, cl.address AS client_address,
            cl.siret AS client_siret, cl.vat_number AS client_vat, q.number AS quote_number
       FROM invoices i LEFT JOIN clients cl ON cl.id = i.client_id
       LEFT JOIN quotes q ON q.id = i.quote_id
      WHERE i.id = $1`,
    [id],
  );
  if (!rows.length) return null;
  const inv = rows[0];
  const items = (
    await pool.query(
      `SELECT position, description, quantity, unit_price, tva_rate
         FROM invoice_items WHERE invoice_id = $1 ORDER BY position, id`,
      [id],
    )
  ).rows;
  if (!items.length) return null;
  const paid = Number(inv.paid) || 0;
  return buildFacturxXml(
    {
      number: inv.number,
      issue_date: inv.issue_date,
      due_date: inv.due_date,
      delivery_date: inv.issue_date,
      purchase_order: inv.quote_number || null,
      payment_terms: inv.conditions || null,
      legal_note: inv.conditions || null,
      total_ht: inv.total_ht,
      total_tva: inv.total_tva,
      total_ttc: inv.total_ttc,
      paid,
      remaining: Math.max(0, Number(inv.total_ttc) - paid),
      items,
      client: {
        name: inv.client_name,
        email: inv.client_email,
        address: inv.client_address || null,
        siret: inv.client_siret,
        vat_number: inv.client_vat,
      },
    },
    company,
  );
}

/* ---------- App ---------- */
const app = new Hono();

app.use("*", async (c, next) => {
  const path = c.req.path;
  const isPublic = PUBLIC_PREFIXES.some((p) => path.startsWith(p));
  if (c.req.method === "OPTIONS") {
    const res = new Response(null, { status: 204 });
    c.res = res;
    applyCors(c);
    return res;
  }
  if (!isPublic && !(await sessionValid(c))) {
    /* applyCors AVANT le return : sans les en-têtes CORS, le navigateur masque
       la réponse 401 et le front ne peut pas détecter une session expirée. */
    applyCors(c);
    return c.json({ error: "Non autorisé" }, 401);
  }
  await next();
  applyCors(c);
});

app.onError((err, c) => {
  console.error("API_ERROR", c.req.path, err);
  applyCors(c);
  return c.json({ error: "Erreur serveur" }, 500);
});

app.get("/health", (c) => c.json({ ok: true }));
app.get("/version", (c) => c.text("palette-api-v3"));

app.get("/api/auth/status", async (c) => {
  const row = await loadCompany(true);
  return c.json({ configured: !!(row && row.app_password) });
});

app.post("/api/login", async (c) => {
  const key = rateKey(c);
  if (isBlocked(key)) {
    return c.json({ error: "Trop de tentatives. Réessayez dans quelques minutes." }, 429);
  }
  let body: any = {};
  try {
    body = await c.req.json();
  } catch {
    /* corps absent */
  }
  const row = await loadCompany(true);
  const configured = !!(row && row.app_password);
  if (!configured) return c.json({ ok: false, configured: false });
  const ok = await verifyPassword(String(body.password || ""), row.app_password);
  if (!ok) {
    noteFailure(key);
    return c.json({ ok: false, configured: true });
  }
  resetFailures(key);
  return c.json({ ok: true, configured: true, session: await sessionToken() });
});

app.get("/api/company", async (c) => c.json(await loadCompany()));

app.put("/api/company", async (c) => {
  const body = await c.req.json();
  const allowed = [
    "name", "owner_name", "siret", "vat_number", "address", "email", "phone", "website",
    "iban", "bic", "logo", "default_tva_rate", "payment_terms", "mentions",
    /* Identifiants legaux obligatoires sur les factures */
    "legal_name", "siren", "rcs", "legal_form", "share_capital", "ape", "address2",
    "zip_code", "city", "country", "insurance",
    /* Conditions de reglement */
    "default_terms_days", "late_penalty_rate", "recovery_fee",
  ];
  const keys = allowed.filter((k) => k in body);
  const sets = keys.map((k) => `${k} = $${keys.indexOf(k) + 1}`);
  const vals = keys.map((k) => body[k]);

  let passwordSet = "";
  if ("app_password" in body) {
    passwordSet = body.app_password ? await storedPassword(String(body.app_password)) : "";
    sets.push(`app_password = $${keys.length + 1}`);
    vals.push(passwordSet);
  }

  const { rows } = await pool.query(
    `UPDATE company SET ${sets.join(", ")}, updated_at = now() WHERE id = 1
     RETURNING *`,
    vals,
  );
  const saved = rows[0];
  delete saved.app_password;
  return c.json(saved);
});

/* ---------- Signataires (signatures reutilisables) ---------- */

app.get("/api/signatories", async (c) => {
  const { rows } = await pool.query(
    "SELECT * FROM signatories ORDER BY sort_order, id",
  );
  return c.json({ items: rows });
});

app.post("/api/signatories", async (c) => {
  const b = await c.req.json();
  if (!String(b.name || "").trim()) return c.json({ error: "Le nom est obligatoire." }, 400);
  const { rows } = await pool.query(
    `INSERT INTO signatories (name, role, image, active, sort_order)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [String(b.name).trim(), b.role || "", b.image || "", b.active === undefined ? true : !!b.active, Number(b.sort_order) || 0],
  );
  return c.json(rows[0], 201);
});

app.put("/api/signatories/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json();
  const cur = (await pool.query("SELECT * FROM signatories WHERE id = $1", [id])).rows[0];
  if (!cur) return c.json({ error: "Signataire introuvable" }, 404);
  const { rows } = await pool.query(
    `UPDATE signatories SET name=$1, role=$2, image=$3, active=$4, sort_order=$5
     WHERE id=$6 RETURNING *`,
    [
      b.name === undefined ? cur.name : String(b.name).trim(),
      b.role === undefined ? cur.role : b.role,
      b.image === undefined ? cur.image : b.image,
      b.active === undefined ? cur.active : !!b.active,
      b.sort_order === undefined ? cur.sort_order : Number(b.sort_order) || 0,
      id,
    ],
  );
  return c.json(rows[0]);
});

app.delete("/api/signatories/:id", async (c) => {
  const id = Number(c.req.param("id"));
  await pool.query("DELETE FROM signatories WHERE id = $1", [id]);
  return c.json({ ok: true });
});

app.get("/api/clients", async (c) => {
  const { rows } = await pool.query(
    "SELECT * FROM clients ORDER BY lower(name)",
  );
  return c.json(rows);
});

app.post("/api/clients", async (c) => {
  const b = await c.req.json();
  const { rows } = await pool.query(
    `INSERT INTO clients (name, siret, vat_number, address, email, phone, notes, no_reminders)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [b.name || "", b.siret || "", b.vat_number || "", b.address || "", b.email || "", b.phone || "", b.notes || "", !!b.no_reminders],
  );
  return c.json(rows[0], 201);
});

app.put("/api/clients/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json();
  const { rows } = await pool.query(
    `UPDATE clients SET name=$1, siret=$2, vat_number=$3, address=$4, email=$5, phone=$6, notes=$7, no_reminders=$8
     WHERE id=$9 RETURNING *`,
    [b.name || "", b.siret || "", b.vat_number || "", b.address || "", b.email || "", b.phone || "", b.notes || "", !!b.no_reminders, id],
  );
  if (!rows[0]) return c.json({ error: "Client introuvable" }, 404);
  return c.json(rows[0]);
});

app.delete("/api/clients/:id", async (c) => {
  const id = Number(c.req.param("id"));
  await pool.query("DELETE FROM clients WHERE id = $1", [id]);
  return c.json({ ok: true });
});

app.get("/api/clients/:id/history", async (c) => {
  const id = Number(c.req.param("id"));
  const quotes = (await pool.query(
    "SELECT id, number, status, issue_date, valid_until, total_ttc FROM quotes WHERE client_id = $1 ORDER BY id DESC",
    [id],
  )).rows;
  const invoices = (await pool.query(
    "SELECT i.id, i.number, i.status, i.issue_date, i.due_date, i.total_ttc, " +
      "coalesce((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid " +
      "FROM invoices i LEFT JOIN quotes q ON q.id = i.quote_id " +
      "WHERE i.client_id = $1 OR (i.quote_id IS NOT NULL AND q.client_id = $1) ORDER BY i.id DESC",
    [id],
  )).rows;
  const orders = (await pool.query(
    "SELECT id, number, status, issue_date, valid_until, total_ttc FROM orders WHERE client_id = $1 ORDER BY id DESC",
    [id],
  )).rows;
  return c.json({ quotes, invoices, orders });
});

async function getQuote(id) {
  const { rows } = await pool.query(
    `SELECT q.*, g.name AS group_name, g.status AS group_status
       FROM quotes q LEFT JOIN quote_groups g ON g.id = q.group_id
      WHERE q.id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const q = rows[0];
  const items = (
    await pool.query(
      "SELECT * FROM quote_items WHERE quote_id = $1 ORDER BY position, id",
      [id],
    )
  ).rows;
  const client = q.client_id
    ? (await pool.query("SELECT * FROM clients WHERE id = $1", [q.client_id])).rows[0] || null
    : null;
  const totals = computeTotals(items);
  return { ...q, items, client, ...totals };
}

async function getOrder(id) {
  const { rows } = await pool.query("SELECT * FROM orders WHERE id = $1", [id]);
  if (!rows[0]) return null;
  const o = rows[0];
  const items = (
    await pool.query(
      "SELECT * FROM order_items WHERE order_id = $1 ORDER BY position, id",
      [id],
    )
  ).rows;
  const client = o.client_id
    ? (await pool.query("SELECT * FROM clients WHERE id = $1", [o.client_id])).rows[0] || null
    : null;
  const totals = computeTotals(items);
  return { ...o, items, client, ...totals };
}

async function getDoc(type, id) {
  if (type === "invoice") return getInvoice(id);
  if (type === "order") return getOrder(id);
  return getQuote(id);
}

/* Determine le dossier d'un devis : par identifiant existant, ou par nom
   (cree le dossier au besoin pour ce client). Retourne null si aucun. */
async function resolveGroupId(client, groupId, groupName, ownerClientId) {
  const name = String(groupName || "").trim();
  if (name) {
    const found = await client.query(
      "SELECT id FROM quote_groups WHERE lower(name) = lower($1) AND client_id IS NOT DISTINCT FROM $2 LIMIT 1",
      [name, ownerClientId || null],
    );
    if (found.rows[0]) return found.rows[0].id;
    const created = await client.query(
      "INSERT INTO quote_groups (name, client_id) VALUES ($1,$2) RETURNING id",
      [name, ownerClientId || null],
    );
    return created.rows[0].id;
  }
  const gid = Number(groupId);
  if (!Number.isFinite(gid) || gid <= 0) return null;
  const g = await client.query("SELECT id FROM quote_groups WHERE id = $1", [gid]);
  return g.rows[0] ? g.rows[0].id : null;
}

app.get("/api/quotes", async (c) => {
  const status = c.req.query("status");
  const params = [];
  let sql =
    "SELECT q.*, g.name AS group_name, g.status AS group_status, " +
    "json_build_object('id', cl.id, 'name', cl.name, 'email', cl.email, 'phone', cl.phone, 'address', cl.address, 'vat_number', cl.vat_number) AS client " +
    "FROM quotes q LEFT JOIN clients cl ON cl.id = q.client_id " +
    "LEFT JOIN quote_groups g ON g.id = q.group_id";
  if (status) {
    params.push(status);
    sql += ` WHERE q.status = $1`;
  }
  sql += " ORDER BY q.id DESC";
  const { rows } = await pool.query(sql, params);
  return c.json(rows);
});

app.get("/api/quotes/:id", async (c) => {
  const q = await getQuote(Number(c.req.param("id")));
  if (!q) return c.json({ error: "Devis introuvable" }, 404);
  return c.json(q);
});

app.post("/api/quotes", async (c) => {
  const b = await c.req.json();
  const client = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
  await client.connect();
  try {
    await client.query("BEGIN");
    const year = new Date().getFullYear();
    const customNumber = String(b.number || "").trim();
    let number: string;
    if (customNumber) {
      if (await numberInUse(client, "quotes", customNumber, null)) {
        await client.query("ROLLBACK");
        await client.end();
        return c.json({ error: `Le numéro ${customNumber} est déjà utilisé.` }, 409);
      }
      number = customNumber;
    } else {
      number = await autoNext(client, "quotes", "dev", year);
    }
    const items = (b.items || []).map(itemProps);
    const totals = computeTotals(items);
    const photos = normalizePhotos(b.photos);
    const groupId = await resolveGroupId(client, b.group_id, b.group_name, b.client_id || null);
    const { rows } = await client.query(
      `INSERT INTO quotes (number, client_id, status, issue_date, valid_until, conditions, notes, total_ht, total_tva, total_ttc, photos, group_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12) RETURNING *`,
      [
        number,
        b.client_id || null,
        b.status || "draft",
        b.issue_date || new Date().toISOString().slice(0, 10),
        b.valid_until || defaultValidFrom(b.issue_date),
        b.conditions || "",
        b.notes || "",
        totals.total_ht,
        totals.total_tva,
        totals.total_ttc,
        JSON.stringify(photos),
        groupId,
      ],
    );
    const q = rows[0];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      await client.query(
        `INSERT INTO quote_items (quote_id, position, description, quantity, unit_price, tva_rate, align, bold, italic, is_block)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [q.id, i, it.description, it.quantity, it.unit_price, it.tva_rate, it.align, it.bold, it.italic, it.is_block],
      );
    }
    await client.query("COMMIT");
    return c.json(await getQuote(q.id), 201);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
});

app.put("/api/quotes/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json();
  const client = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
  await client.connect();
  try {
    await client.query("BEGIN");
    const cur = (await client.query("SELECT number, client_id, status, issue_date, valid_until, conditions, notes, group_id FROM quotes WHERE id = $1", [id])).rows[0];
    if (!cur) {
      await client.query("ROLLBACK");
      await client.end();
      return c.json({ error: "Devis introuvable" }, 404);
    }
    const customNumber = String(b.number ?? "").trim();
    const number = customNumber !== "" && customNumber !== cur.number ? customNumber : cur.number;
    if (number !== cur.number && (await numberInUse(client, "quotes", number, id))) {
      await client.query("ROLLBACK");
      await client.end();
      return c.json({ error: `Le numéro ${number} est déjà utilisé.` }, 409);
    }
    const items = (b.items || []).map(itemProps);
    const totals = computeTotals(items);
    const photos = normalizePhotos(b.photos);
    const nextClientId = b.client_id === undefined ? cur.client_id : b.client_id;
    /* b.group_id === null vide le dossier ; absent = conserve ; sinon on resout. */
    let groupId = cur.group_id;
    if (b.group_name !== undefined && String(b.group_name || "").trim() !== "") {
      groupId = await resolveGroupId(client, null, b.group_name, nextClientId);
    } else if (b.group_id !== undefined) {
      groupId = await resolveGroupId(client, b.group_id, null, nextClientId);
    }
    const { rows } = await client.query(
      `UPDATE quotes SET client_id=$1, status=$2, issue_date=$3, valid_until=$4,
        conditions=$5, notes=$6, total_ht=$7, total_tva=$8, total_ttc=$9, number=$10, photos=$11::jsonb, group_id=$13, updated_at=now()
       WHERE id=$12 RETURNING *`,
      [
        nextClientId,
        b.status === undefined ? cur.status : b.status,
        b.issue_date || cur.issue_date,
        b.valid_until || defaultValidFrom(b.issue_date || cur.issue_date),
        b.conditions === undefined ? cur.conditions : b.conditions,
        b.notes === undefined ? cur.notes : b.notes,
        totals.total_ht,
        totals.total_tva,
        totals.total_ttc,
        number,
        JSON.stringify(photos),
        id,
        groupId,
      ],
    );
    if (!rows[0]) {
      await client.query("ROLLBACK");
      await client.end();
      return c.json({ error: "Devis introuvable" }, 404);
    }
    await client.query("DELETE FROM quote_items WHERE quote_id = $1", [id]);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      await client.query(
        `INSERT INTO quote_items (quote_id, position, description, quantity, unit_price, tva_rate, align, bold, italic, is_block)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, i, it.description, it.quantity, it.unit_price, it.tva_rate, it.align, it.bold, it.italic, it.is_block],
      );
    }
    const syncedInvoice = await syncInvoiceFromSource(client, "quotes", id, items, totals, b.conditions || "", photos);
    await client.query("COMMIT");
    const q = await getQuote(id);
    if (!q) return c.json({ error: "Devis introuvable" }, 404);
    return c.json({ ...q, synced_invoice_id: syncedInvoice });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
});

app.post("/api/quotes/:id/signature", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json();
  const exists = (await pool.query("SELECT id FROM quotes WHERE id = $1", [id])).rows[0];
  if (!exists) return c.json({ error: "Devis introuvable" }, 404);

  const signed = !!b.signed;
  const mention = typeof b.signature_mention === "string" ? b.signature_mention : undefined;

  /* Instantane des signataires : le document signe reste intact meme si la
     personne est renommee ou supprimee plus tard. */
  let snapshots: Array<Record<string, unknown>> = [];
  if (signed) {
    const ids = Array.isArray(b.signed_by)
      ? b.signed_by.map((x: unknown) => Number(x)).filter((n: number) => Number.isFinite(n))
      : [];
    if (ids.length) {
      const { rows } = await pool.query("SELECT id, name, role, image FROM signatories WHERE id = ANY($1)", [ids]);
      const byId = new Map(rows.map((r: any) => [r.id, r]));
      snapshots = ids.map((sid: number) => byId.get(sid)).filter(Boolean);
    }
  }

  const signedAt = signed ? (b.signed_at || new Date().toISOString()) : null;
  await pool.query(
    `UPDATE quotes SET signed=$1, signed_at=$2, signed_by=$3::jsonb,
       signature_mention = CASE WHEN $4::text IS NULL THEN signature_mention ELSE $4 END,
       updated_at=now()
     WHERE id=$5`,
    [signed, signedAt, JSON.stringify(snapshots), mention === undefined ? null : mention, id],
  );
  return c.json(await getQuote(id));
});

app.post("/api/quotes/:id/status", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json();
  const allowed = ["draft", "sent", "accepted", "declined", "invoiced"];
  if (!allowed.includes(b.status)) return c.json({ error: "Statut invalide" }, 400);
  const { rows } = await pool.query(
    "UPDATE quotes SET status = $1, updated_at = now() WHERE id = $2 RETURNING *",
    [b.status, id],
  );
  if (!rows[0]) return c.json({ error: "Devis introuvable" }, 404);
  return c.json(rows[0]);
});

app.get("/api/quotes/:id/share", async (c) => {
  const id = Number(c.req.param("id"));
  const q = (await pool.query("SELECT id, number FROM quotes WHERE id = $1", [id])).rows[0];
  if (!q) return c.json({ error: "Devis introuvable" }, 404);
  const sig = await hmacHex(SESSION_SECRET, `verify:${id}`);
  return c.json({ id: q.id, number: q.number, sig });
});

app.delete("/api/quotes/:id", async (c) => {
  const id = Number(c.req.param("id"));
  await pool.query("DELETE FROM quotes WHERE id = $1", [id]);
  return c.json({ ok: true });
});

/* ---------- Dossiers de devis (variantes d'un meme produit) ---------- */

app.get("/api/quote-groups", async (c) => {
  const { rows } = await pool.query(
    `SELECT g.*, json_build_object('id', cl.id, 'name', cl.name) AS client,
            (SELECT count(*) FROM quotes q WHERE q.group_id = g.id) AS quote_count,
            (SELECT count(*) FROM invoices i WHERE i.group_id = g.id) AS invoice_count
       FROM quote_groups g LEFT JOIN clients cl ON cl.id = g.client_id
      ORDER BY g.id DESC`,
  );
  return c.json(rows);
});

app.post("/api/quote-groups", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const name = String(b.name || "").trim();
  if (!name) return c.json({ error: "Nom du dossier obligatoire" }, 400);
  const clientId = b.client_id || null;
  /* Anti-doublon : un meme nom pour un meme client reutilise le dossier existant
     (evite la creation de dossiers orphelins a chaque frappe/retry). */
  const existing = (
    await pool.query(
      "SELECT * FROM quote_groups WHERE lower(name) = lower($1) AND client_id IS NOT DISTINCT FROM $2 LIMIT 1",
      [name, clientId],
    )
  ).rows[0];
  if (existing) return c.json(existing);
  const { rows } = await pool.query(
    "INSERT INTO quote_groups (name, client_id, notes) VALUES ($1,$2,$3) RETURNING *",
    [name, clientId, b.notes || ""],
  );
  return c.json(rows[0], 201);
});

app.get("/api/quote-groups/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const g = (await pool.query("SELECT * FROM quote_groups WHERE id = $1", [id])).rows[0];
  if (!g) return c.json({ error: "Dossier introuvable" }, 404);
  const quotes = (
    await pool.query(
      `SELECT q.*, g.name AS group_name, g.status AS group_status
         FROM quotes q LEFT JOIN quote_groups g ON g.id = q.group_id
        WHERE q.group_id = $1 ORDER BY q.id DESC`,
      [id],
    )
  ).rows;
  const invoices = (
    await pool.query(
      `SELECT i.*, g.name AS group_name, g.status AS group_status
         FROM invoices i LEFT JOIN quote_groups g ON g.id = i.group_id
        WHERE i.group_id = $1 ORDER BY i.id DESC`,
      [id],
    )
  ).rows;
  return c.json({ ...g, quotes, invoices });
});

app.put("/api/quote-groups/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json().catch(() => ({}));
  const cur = (await pool.query("SELECT * FROM quote_groups WHERE id = $1", [id])).rows[0];
  if (!cur) return c.json({ error: "Dossier introuvable" }, 404);
  const name = b.name === undefined ? cur.name : String(b.name).trim();
  if (!name) return c.json({ error: "Nom du dossier obligatoire" }, 400);
  const { rows } = await pool.query(
    "UPDATE quote_groups SET name=$1, client_id=$2, notes=$3, updated_at=now() WHERE id=$4 RETURNING *",
    [name, b.client_id === undefined ? cur.client_id : b.client_id || null, b.notes === undefined ? cur.notes : b.notes, id],
  );
  return c.json(rows[0]);
});

app.delete("/api/quote-groups/:id", async (c) => {
  const id = Number(c.req.param("id"));
  /* On detache les devis et factures : ils redeviennent autonomes, aucune donnee perdue. */
  await pool.query("UPDATE quotes SET group_id = NULL WHERE group_id = $1", [id]);
  await pool.query("UPDATE invoices SET group_id = NULL WHERE group_id = $1", [id]);
  await pool.query("DELETE FROM quote_groups WHERE id = $1", [id]);
  return c.json({ ok: true });
});

/* Rattacher un devis a un dossier (meme client). */
app.post("/api/quote-groups/:id/quotes", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json().catch(() => ({}));
  const quoteId = Number(b.quote_id);
  const g = (await pool.query("SELECT * FROM quote_groups WHERE id = $1", [id])).rows[0];
  if (!g) return c.json({ error: "Dossier introuvable" }, 404);
  const q = (await pool.query("SELECT id, client_id FROM quotes WHERE id = $1", [quoteId])).rows[0];
  if (!q) return c.json({ error: "Devis introuvable" }, 404);
  if (g.client_id && q.client_id && g.client_id !== q.client_id) {
    return c.json({ error: "Le devis et le dossier n'ont pas le même client." }, 400);
  }
  if (!g.client_id) await pool.query("UPDATE quote_groups SET client_id = $1 WHERE id = $2", [q.client_id, id]);
  await pool.query("UPDATE quotes SET group_id = $1, updated_at = now() WHERE id = $2", [id, quoteId]);
  return c.json(await getQuote(quoteId));
});

/* Detacher un devis d'un dossier. */
app.delete("/api/quote-groups/:id/quotes/:quoteId", async (c) => {
  const id = Number(c.req.param("id"));
  const quoteId = Number(c.req.param("quoteId"));
  await pool.query("UPDATE quotes SET group_id = NULL, updated_at = now() WHERE id = $1 AND group_id = $2", [quoteId, id]);
  return c.json({ ok: true });
});

/* Rattacher une facture a un dossier (meme client). */
app.post("/api/quote-groups/:id/invoices", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json().catch(() => ({}));
  const invoiceId = Number(b.invoice_id);
  const g = (await pool.query("SELECT * FROM quote_groups WHERE id = $1", [id])).rows[0];
  if (!g) return c.json({ error: "Dossier introuvable" }, 404);
  const inv = (
    await pool.query(
      "SELECT i.id, COALESCE(i.client_id, (SELECT q.client_id FROM quotes q WHERE q.id = i.quote_id)) AS client_id FROM invoices i WHERE i.id = $1",
      [invoiceId],
    )
  ).rows[0];
  if (!inv) return c.json({ error: "Facture introuvable" }, 404);
  if (g.client_id && inv.client_id && g.client_id !== inv.client_id) {
    return c.json({ error: "La facture et le dossier n'ont pas le même client." }, 400);
  }
  if (!g.client_id && inv.client_id) await pool.query("UPDATE quote_groups SET client_id = $1 WHERE id = $2", [inv.client_id, id]);
  await pool.query("UPDATE invoices SET group_id = $1, updated_at = now() WHERE id = $2", [id, invoiceId]);
  return c.json(await getInvoice(invoiceId));
});

/* Detacher une facture d'un dossier. */
app.delete("/api/quote-groups/:id/invoices/:invoiceId", async (c) => {
  const id = Number(c.req.param("id"));
  const invoiceId = Number(c.req.param("invoiceId"));
  await pool.query("UPDATE invoices SET group_id = NULL, updated_at = now() WHERE id = $1 AND group_id = $2", [invoiceId, id]);
  return c.json({ ok: true });
});

/* Definir (ou vider) le dossier d'une facture directement depuis la facture.
   Le dossier doit appartenir au meme client que la facture. */
app.put("/api/invoices/:id/group", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json().catch(() => ({}));
  const inv = (
    await pool.query(
      "SELECT i.id, COALESCE(i.client_id, (SELECT q.client_id FROM quotes q WHERE q.id = i.quote_id)) AS client_id FROM invoices i WHERE i.id = $1",
      [id],
    )
  ).rows[0];
  if (!inv) return c.json({ error: "Facture introuvable" }, 404);
  if (b.group_id === null || (b.group_id === undefined && !String(b.group_name || "").trim())) {
    await pool.query("UPDATE invoices SET group_id = NULL, updated_at = now() WHERE id = $1", [id]);
    return c.json(await getInvoice(id));
  }
  const groupId = await resolveGroupId(pool, b.group_id, b.group_name, inv.client_id);
  if (!groupId) return c.json({ error: "Dossier introuvable" }, 404);
  const g = (await pool.query("SELECT client_id FROM quote_groups WHERE id = $1", [groupId])).rows[0];
  if (g && g.client_id && inv.client_id && g.client_id !== inv.client_id) {
    return c.json({ error: "La facture et le dossier n'ont pas le même client." }, 400);
  }
  await pool.query("UPDATE invoices SET group_id = $1, updated_at = now() WHERE id = $2", [groupId, id]);
  return c.json(await getInvoice(id));
});

/* Le client a choisi une variante : elle est acceptee, les autres refusees,
   et le dossier passe a « choisi ». */
app.post("/api/quote-groups/:id/choose", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json().catch(() => ({}));
  const quoteId = Number(b.quote_id);
  const g = (await pool.query("SELECT * FROM quote_groups WHERE id = $1", [id])).rows[0];
  if (!g) return c.json({ error: "Dossier introuvable" }, 404);
  const q = (await pool.query("SELECT id, status FROM quotes WHERE id = $1 AND group_id = $2", [quoteId, id])).rows[0];
  if (!q) return c.json({ error: "Ce devis n'appartient pas au dossier." }, 400);
  if (q.status === "invoiced") return c.json({ error: "Ce devis est déjà facturé." }, 409);
  const pgClient = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
  await pgClient.connect();
  try {
    await pgClient.query("BEGIN");
    await pgClient.query(
      "UPDATE quotes SET status='accepted', updated_at=now() WHERE id = $1",
      [quoteId],
    );
    await pgClient.query(
      "UPDATE quotes SET status='declined', updated_at=now() WHERE group_id = $1 AND id <> $2 AND status IN ('draft','sent')",
      [id, quoteId],
    );
    await pgClient.query(
      "UPDATE quote_groups SET status='chosen', chosen_quote_id=$1, updated_at=now() WHERE id=$2",
      [quoteId, id],
    );
    await pgClient.query("COMMIT");
  } catch (e) {
    await pgClient.query("ROLLBACK");
    throw e;
  } finally {
    await pgClient.end();
  }
  const group = (await pool.query("SELECT * FROM quote_groups WHERE id = $1", [id])).rows[0];
  const quotes = (await pool.query("SELECT id, number, status FROM quotes WHERE group_id = $1 ORDER BY id", [id])).rows;
  return c.json({ ...group, quotes });
});

/* Dupliquer un devis : memes lignes et photos, nouveau numero, brouillon.
   Sert a creer rapidement les variantes d'un meme produit. */
app.post("/api/quotes/:id/duplicate", async (c) => {
  const id = Number(c.req.param("id"));
  const src = (await pool.query("SELECT * FROM quotes WHERE id = $1", [id])).rows[0];
  if (!src) return c.json({ error: "Devis introuvable" }, 404);
  const items = (
    await pool.query("SELECT * FROM quote_items WHERE quote_id = $1 ORDER BY position, id", [id])
  ).rows;
  const client = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
  await client.connect();
  try {
    await client.query("BEGIN");
    const year = new Date().getFullYear();
    const number = await autoNext(client, "quotes", "dev", year);
    const { rows } = await client.query(
      `INSERT INTO quotes (number, client_id, status, issue_date, valid_until, conditions, notes, total_ht, total_tva, total_ttc, photos, group_id)
       VALUES ($1,$2,'draft',$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) RETURNING *`,
      [
        number,
        src.client_id,
        new Date().toISOString().slice(0, 10),
        defaultValidFrom(new Date().toISOString().slice(0, 10)),
        src.conditions || "",
        src.notes || "",
        src.total_ht,
        src.total_tva,
        src.total_ttc,
        JSON.stringify(normalizePhotos(src.photos)),
        src.group_id,
      ],
    );
    const q = rows[0];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      await client.query(
        `INSERT INTO quote_items (quote_id, position, description, quantity, unit_price, tva_rate, align, bold, italic, is_block)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [q.id, i, it.description, it.quantity, it.unit_price, it.tva_rate, it.align, !!it.bold, !!it.italic, !!it.is_block],
      );
    }
    await client.query("COMMIT");
    return c.json(await getQuote(q.id), 201);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
});

app.get("/api/orders", async (c) => {
  const status = c.req.query("status");
  const params = [];
  let sql =
    "SELECT o.*, " +
    "json_build_object('id', cl.id, 'name', cl.name, 'email', cl.email, 'phone', cl.phone, 'address', cl.address, 'vat_number', cl.vat_number) AS client " +
    "FROM orders o LEFT JOIN clients cl ON cl.id = o.client_id";
  if (status) {
    sql += " WHERE o.status = $1";
    params.push(status);
  }
  sql += " ORDER BY o.id DESC";
  const { rows } = await pool.query(sql, params);
  return c.json(rows);
});

app.get("/api/orders/:id", async (c) => {
  const o = await getOrder(Number(c.req.param("id")));
  if (!o) return c.json({ error: "Bon de commande introuvable" }, 404);
  return c.json(o);
});

app.post("/api/orders", async (c) => {
  const b = await c.req.json();
  const client = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
  await client.connect();
  try {
    await client.query("BEGIN");
    const year = new Date().getFullYear();
    const customNumber = String(b.number || "").trim();
    let number: string;
    if (customNumber) {
      if (await numberInUse(client, "orders", customNumber, null)) {
        await client.query("ROLLBACK");
        await client.end();
        return c.json({ error: `Le numéro ${customNumber} est déjà utilisé.` }, 409);
      }
      number = customNumber;
    } else {
      number = await autoNext(client, "orders", "bc", year);
    }
    const items = (b.items || []).map(itemProps);
    const totals = computeTotals(items);
    const photos = normalizePhotos(b.photos);
    const { rows } = await client.query(
      `INSERT INTO orders (number, client_id, status, issue_date, valid_until, conditions, notes, total_ht, total_tva, total_ttc, photos)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) RETURNING *`,
      [
        number,
        b.client_id || null,
        b.status || "draft",
        b.issue_date || new Date().toISOString().slice(0, 10),
        b.valid_until || defaultValidFrom(b.issue_date),
        b.conditions || "",
        b.notes || "",
        totals.total_ht,
        totals.total_tva,
        totals.total_ttc,
        JSON.stringify(photos),
      ],
    );
    const o = rows[0];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      await client.query(
        `INSERT INTO order_items (order_id, position, description, quantity, unit_price, tva_rate, align, bold, italic, is_block)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [o.id, i, it.description, it.quantity, it.unit_price, it.tva_rate, it.align, it.bold, it.italic, it.is_block],
      );
    }
    await client.query("COMMIT");
    return c.json(await getOrder(o.id), 201);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
});

app.put("/api/orders/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json();
  const client = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
  await client.connect();
  try {
    await client.query("BEGIN");
    const cur = (await client.query("SELECT number, client_id, status, issue_date, valid_until, conditions, notes FROM orders WHERE id = $1", [id])).rows[0];
    if (!cur) {
      await client.query("ROLLBACK");
      await client.end();
      return c.json({ error: "Bon de commande introuvable" }, 404);
    }
    const customNumber = String(b.number ?? "").trim();
    const number = customNumber !== "" && customNumber !== cur.number ? customNumber : cur.number;
    if (number !== cur.number && (await numberInUse(client, "orders", number, id))) {
      await client.query("ROLLBACK");
      await client.end();
      return c.json({ error: `Le numéro ${number} est déjà utilisé.` }, 409);
    }
    const items = (b.items || []).map(itemProps);
    const totals = computeTotals(items);
    const photos = normalizePhotos(b.photos);
    const { rows } = await client.query(
      `UPDATE orders SET client_id=$1, status=$2, issue_date=$3, valid_until=$4,
        conditions=$5, notes=$6, total_ht=$7, total_tva=$8, total_ttc=$9, number=$10, photos=$11::jsonb, updated_at=now()
       WHERE id=$12 RETURNING *`,
      [
        b.client_id === undefined ? cur.client_id : b.client_id,
        b.status === undefined ? cur.status : b.status,
        b.issue_date || cur.issue_date,
        b.valid_until || cur.valid_until,
        b.conditions === undefined ? cur.conditions : b.conditions,
        b.notes === undefined ? cur.notes : b.notes,
        totals.total_ht,
        totals.total_tva,
        totals.total_ttc,
        number,
        JSON.stringify(photos),
        id,
      ],
    );
    if (!rows[0]) {
      await client.query("ROLLBACK");
      await client.end();
      return c.json({ error: "Bon de commande introuvable" }, 404);
    }
    await client.query("DELETE FROM order_items WHERE order_id = $1", [id]);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      await client.query(
        `INSERT INTO order_items (order_id, position, description, quantity, unit_price, tva_rate, align, bold, italic, is_block)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, i, it.description, it.quantity, it.unit_price, it.tva_rate, it.align, it.bold, it.italic, it.is_block],
      );
    }
    const syncedInvoice = await syncInvoiceFromSource(client, "orders", id, items, totals, b.conditions === undefined ? cur.conditions : b.conditions, photos);
    await client.query("COMMIT");
    const o = await getOrder(id);
    if (!o) return c.json({ error: "Bon de commande introuvable" }, 404);
    return c.json({ ...o, synced_invoice_id: syncedInvoice });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
});

app.post("/api/orders/:id/status", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json();
  const allowed = ["draft", "sent", "accepted", "declined", "invoiced"];
  if (!allowed.includes(b.status)) return c.json({ error: "Statut invalide" }, 400);
  const { rows } = await pool.query(
    "UPDATE orders SET status = $1, updated_at = now() WHERE id = $2 RETURNING *",
    [b.status, id],
  );
  if (!rows[0]) return c.json({ error: "Bon de commande introuvable" }, 404);
  return c.json(rows[0]);
});

app.delete("/api/orders/:id", async (c) => {
  const id = Number(c.req.param("id"));
  await pool.query("DELETE FROM orders WHERE id = $1", [id]);
  return c.json({ ok: true });
});

app.post("/api/orders/:id/convert", async (c) => {
  const id = Number(c.req.param("id"));
  const client = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
  await client.connect();
  try {
    await client.query("BEGIN");
    const { rows: orows } = await client.query(
      "SELECT * FROM orders WHERE id = $1 FOR UPDATE",
      [id],
    );
    const o = orows[0];
    if (!o) {
      await client.query("ROLLBACK");
      await client.end();
      return c.json({ error: "Bon de commande introuvable" }, 404);
    }
    if (o.status === "invoiced") {
      const existing = (
        await client.query("SELECT * FROM invoices WHERE order_id = $1", [id])
      ).rows;
      await client.query("COMMIT");
      await client.end();
      return c.json({ ...existing[0], already: true });
    }
    const year = new Date().getFullYear();
    const body = await c.req.json().catch(() => ({}));
    const customNumber = String((body && body.number) || "").trim();
    let number: string;
    if (customNumber) {
      if (await numberInUse(client, "invoices", customNumber, null)) {
        await client.query("ROLLBACK");
        await client.end();
        return c.json({ error: `Le numéro ${customNumber} est déjà utilisé.` }, 409);
      }
      number = customNumber;
    } else {
      number = await autoNext(client, "invoices", "fac", year);
    }
    const { rows } = await client.query(
      `INSERT INTO invoices (number, quote_id, client_id, order_id, status, issue_date, due_date, conditions, total_ht, total_tva, total_ttc, photos)
       VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) RETURNING *`,
      [
        number,
        o.client_id,
        id,
        "unpaid",
        o.issue_date,
        o.valid_until,
        o.conditions,
        o.total_ht,
        o.total_tva,
        o.total_ttc,
        JSON.stringify(normalizePhotos(o.photos)),
      ],
    );
    const inv = rows[0];
    const itemRows = (
      await client.query(
        "SELECT * FROM order_items WHERE order_id = $1 ORDER BY position, id",
        [id],
      )
    ).rows;
    for (let i = 0; i < itemRows.length; i++) {
      const it = itemRows[i];
      await client.query(
        `INSERT INTO invoice_items (invoice_id, position, description, quantity, unit_price, tva_rate, align, bold, italic, is_block)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [inv.id, i, it.description, it.quantity, it.unit_price, it.tva_rate, it.align, !!it.bold, !!it.italic, !!it.is_block],
      );
    }
    await client.query("UPDATE orders SET status = 'invoiced', updated_at = now() WHERE id = $1", [id]);
    await client.query("COMMIT");
    const full = await getInvoice(inv.id);
    return c.json(full, 201);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
});

async function getInvoice(id) {
  const { rows } = await pool.query("SELECT * FROM invoices WHERE id = $1", [id]);
  if (!rows[0]) return null;
  const inv = rows[0];
  const items = (
    await pool.query(
      "SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY position, id",
      [id],
    )
  ).rows;
  const client = inv.client_id
    ? (await pool.query("SELECT * FROM clients WHERE id = $1", [inv.client_id])).rows[0] || null
    : inv.quote_id
      ? (await pool.query(
          "SELECT c.* FROM quotes q JOIN clients c ON c.id = q.client_id WHERE q.id = $1",
          [inv.quote_id],
        )).rows[0] || null
      : null;
  const quote = inv.quote_id
    ? (await pool.query("SELECT * FROM quotes WHERE id = $1", [inv.quote_id])).rows[0] || null
    : null;
  const payments = await listPayments(id);
  const paid = money(payments.reduce((s, p) => s + Number(p.amount), 0));
  const remaining = money(Math.max(Number(inv.total_ttc) - paid, 0));
  const group = inv.group_id
    ? (await pool.query("SELECT name, status FROM quote_groups WHERE id = $1", [inv.group_id])).rows[0] || null
    : null;
  return {
    ...inv,
    group_name: group ? group.name : null,
    group_status: group ? group.status : null,
    items,
    client,
    quote,
    payments,
    paid,
    remaining,
  };
}

app.get("/api/invoices", async (c) => {
  const { rows } = await pool.query(
    "SELECT inv.*, " +
      "qt.number AS quote_number, " +
      "g.name AS group_name, g.status AS group_status, " +
      "coalesce((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id = inv.id), 0) AS paid, " +
      "json_build_object('id', cl.id, 'name', cl.name, 'email', cl.email, 'phone', cl.phone, 'address', cl.address, 'vat_number', cl.vat_number) AS client " +
      "FROM invoices inv LEFT JOIN quotes qt ON qt.id = inv.quote_id LEFT JOIN quote_groups g ON g.id = inv.group_id LEFT JOIN clients cl ON cl.id = COALESCE(inv.client_id, qt.client_id) ORDER BY inv.id DESC",
  );
  return c.json(rows);
});

app.get("/api/invoices/:id", async (c) => {
  const inv = await getInvoice(Number(c.req.param("id")));
  if (!inv) return c.json({ error: "Facture introuvable" }, 404);
  return c.json(inv);
});

app.post("/api/quotes/:id/convert", async (c) => {
  const id = Number(c.req.param("id"));
  const client = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
  await client.connect();
  try {
    await client.query("BEGIN");
    const { rows: qrows } = await client.query(
      "SELECT * FROM quotes WHERE id = $1 FOR UPDATE",
      [id],
    );
    const q = qrows[0];
    if (!q) {
      await client.query("ROLLBACK");
      await client.end();
      return c.json({ error: "Devis introuvable" }, 404);
    }
    if (q.status === "invoiced") {
      const existing = (
        await client.query("SELECT * FROM invoices WHERE quote_id = $1", [id])
      ).rows;
      await client.query("COMMIT");
      await client.end();
      return c.json({ ...existing[0], already: true });
    }
    const year = new Date().getFullYear();
    const body = await c.req.json().catch(() => ({}));
    const customNumber = String((body && body.number) || "").trim();
    let number: string;
    if (customNumber) {
      if (await numberInUse(client, "invoices", customNumber, null)) {
        await client.query("ROLLBACK");
        await client.end();
        return c.json({ error: `Le numéro ${customNumber} est déjà utilisé.` }, 409);
      }
      number = customNumber;
    } else {
      number = await autoNext(client, "invoices", "fac", year);
    }
    const { rows } = await client.query(
      `INSERT INTO invoices (number, quote_id, client_id, status, issue_date, due_date, conditions, total_ht, total_tva, total_ttc, photos, group_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12) RETURNING *`,
      [
        number,
        id,
        q.client_id,
        "unpaid",
        q.issue_date,
        q.valid_until,
        q.conditions,
        q.total_ht,
        q.total_tva,
        q.total_ttc,
        JSON.stringify(normalizePhotos(q.photos)),
        q.group_id || null,
      ],
    );
    const inv = rows[0];
    const itemRows = (
      await client.query(
        "SELECT * FROM quote_items WHERE quote_id = $1 ORDER BY position, id",
        [id],
      )
    ).rows;
    for (let i = 0; i < itemRows.length; i++) {
      const it = itemRows[i];
      await client.query(
        `INSERT INTO invoice_items (invoice_id, position, description, quantity, unit_price, tva_rate, align, bold, italic, is_block)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [inv.id, i, it.description, it.quantity, it.unit_price, it.tva_rate, it.align, !!it.bold, !!it.italic, !!it.is_block],
      );
    }
    await client.query("UPDATE quotes SET status = 'invoiced', updated_at = now() WHERE id = $1", [id]);
    await client.query("COMMIT");
    const full = await getInvoice(inv.id);
    return c.json(full, 201);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
});

app.post("/api/invoices/:id/status", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json();
  const allowed = ["unpaid", "paid", "partial"];
  if (!allowed.includes(b.status)) return c.json({ error: "Statut invalide" }, 400);
  const { rows } = await pool.query(
    "UPDATE invoices SET status = $1, updated_at = now() WHERE id = $2 RETURNING *",
    [b.status, id],
  );
  if (!rows[0]) return c.json({ error: "Facture introuvable" }, 404);
  return c.json(rows[0]);
});

app.get("/api/invoices/:id/payments", async (c) => {
  const id = Number(c.req.param("id"));
  const inv = await getInvoice(id);
  if (!inv) return c.json({ error: "Facture introuvable" }, 404);
  return c.json({ payments: inv.payments, paid: inv.paid, remaining: inv.remaining });
});

app.post("/api/invoices/:id/payments", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json();
  const inv = await getInvoice(id);
  if (!inv) return c.json({ error: "Facture introuvable" }, 404);
  const amount = money(Number(b.amount) || 0);
  if (amount <= 0) return c.json({ error: "Montant invalide" }, 400);
  const { rows } = await pool.query(
    `INSERT INTO payments (invoice_id, amount, method, date, note)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [id, amount, b.method || "", b.date || new Date().toISOString().slice(0, 10), b.note || ""],
  );
  /* Synchronisation Tresorerie : un encaissement cree un mouvement bancaire (entree). */
  await syncPaymentTransaction(
    pool,
    rows[0],
    inv.number,
    inv.client?.id ?? inv.client_id ?? null,
    b.account_id ? Number(b.account_id) : null,
  );
  const paidAfter = money(inv.paid + amount);
  const remainingAfter = money(Math.max(Number(inv.total_ttc) - paidAfter, 0));
  const status = remainingAfter <= 0 ? "paid" : "partial";
  await pool.query("UPDATE invoices SET status = $1, updated_at = now() WHERE id = $2", [status, id]);
  return c.json({ payment: rows[0], status, paid: paidAfter, remaining: remainingAfter }, 201);
});

app.delete("/api/invoices/:id/payments/:pid", async (c) => {
  const id = Number(c.req.param("id"));
  const pid = Number(c.req.param("pid"));
  const inv = await getInvoice(id);
  if (!inv) return c.json({ error: "Facture introuvable" }, 404);
  const { rowCount } = await pool.query("DELETE FROM payments WHERE id = $1 AND invoice_id = $2", [pid, id]);
  if (!rowCount) return c.json({ error: "Règlement introuvable" }, 404);
  /* Retire le mouvement bancaire genere pour ce reglement (l'ON DELETE CASCADE le
     fait aussi, cette suppression explicite garantit la synchro meme sans elle). */
  await removePaymentTransaction(pool, pid);
  const payments = await listPayments(id);
  const paid = money(payments.reduce((s, p) => s + Number(p.amount), 0));
  const status = paid <= 0 ? "unpaid" : "partial";
  await pool.query("UPDATE invoices SET status = $1, updated_at = now() WHERE id = $2", [status, id]);
  return c.json(await getInvoice(id));
});

app.delete("/api/invoices/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const inv = (
    await pool.query("SELECT quote_id, finalized, finalized_at FROM invoices WHERE id = $1", [id])
  ).rows[0];
  if (!inv) return c.json({ error: "Facture introuvable" }, 404);
  /* Veko d'immuabilite : une facture finalisee est un document comptable.
     Elle ne se supprime plus, elle se corrige par un avoir. */
  if (inv.finalized) {
    return c.json(
      {
        error:
          "Facture finalisee : suppression impossible. Emettez un avoir pour la corriger, la facture reste tracee pour la comptabilite.",
        finalized_at: inv.finalized_at,
        remedy: "credit_note",
      },
      409,
    );
  }
  if (inv.quote_id) {
    /* Ne rebascule le devis en 'accepted' que s'il ne lui reste aucune autre
       facture : un même devis peut avoir plusieurs factures. */
    const siblings = await pool.query(
      "SELECT 1 FROM invoices WHERE quote_id = $1 AND id <> $2 LIMIT 1",
      [inv.quote_id, id],
    );
    if (siblings.rowCount === 0) {
      await pool.query(
        "UPDATE quotes SET status = 'accepted', updated_at = now() WHERE id = $1 AND status = 'invoiced'",
        [inv.quote_id],
      );
    }
  }
  await pool.query("DELETE FROM invoices WHERE id = $1", [id]);
  return c.json({ ok: true });
});

/* ---------- Sauvegarde / restauration ---------- */
const BACKUP_TABLES = ["company", "clients", "quotes", "quote_items", "invoices", "invoice_items", "payments", "counters"];
const SEQ_TABLES = ["clients", "quotes", "quote_items", "invoices", "invoice_items", "payments"];

app.get("/api/backup", async (c) => {
  const out = { exported_at: new Date().toISOString(), version: 1 };
  for (const t of BACKUP_TABLES) {
    out[t] = (await pool.query(`SELECT * FROM ${t}`)).rows;
  }
  return c.json(out);
});

app.post("/api/backup/restore", async (c) => {
  const body = await c.req.json();
  const data = body.data;
  if (!data || !Array.isArray(data.clients) || !Array.isArray(data.quotes)) {
    return c.json({ error: "Fichier de sauvegarde invalide" }, 400);
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("TRUNCATE payments, invoice_items, invoices, quote_items, quotes, clients, counters RESTART IDENTITY CASCADE");

    for (const t of ["counters", "clients", "quotes", "quote_items", "invoices", "invoice_items", "payments"]) {
      const rows = data[t] || [];
      if (!rows.length) continue;
      if (t === "counters") {
        for (const r of rows) {
          await client.query(
            "INSERT INTO counters (kind, value) VALUES ($1,$2) ON CONFLICT (kind) DO UPDATE SET value = EXCLUDED.value",
            [String(r.kind || ""), Number(r.value) || 0],
          );
        }
        continue;
      }
      const keys = Object.keys(rows[0]);
      const cols = keys.join(", ");
      const ph = keys.map((_, i) => `$${i + 1}`).join(", ");
      for (const r of rows) {
        await client.query(
          `INSERT INTO ${t} (${cols}) VALUES (${ph})`,
          keys.map((k) => (r[k] === undefined ? null : r[k])),
        );
      }
    }

    const co = (data.company || [])[0];
    if (co) {
      const { id, updated_at, ...rest } = co;
      const keys = Object.keys(rest);
      const sets = keys.map((k) => `${k} = EXCLUDED.${k}`);
      await client.query(
        `INSERT INTO company (id, ${keys.join(", ")}) VALUES (1, ${keys.map((_, i) => `$${i + 1}`).join(", ")})
         ON CONFLICT (id) DO UPDATE SET ${sets.join(", ")}`,
        keys.map((k) => (rest[k] === undefined ? null : rest[k])),
      );
    }

    for (const t of SEQ_TABLES) {
      const mx = Number((await client.query(`SELECT coalesce(max(id), 0) AS mx FROM ${t}`)).rows[0].mx);
      await client.query(`SELECT setval('${t}_id_seq', $1, $2)`, [mx > 0 ? mx : 1, mx > 0]);
    }

    await client.query("COMMIT");
    return c.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    return c.json({ error: `Restauration impossible : ${e.message}` }, 500);
  } finally {
    await client.end();
  }
});

/* ---------- Statistiques & relances ---------- */
app.get("/api/stats", async (c) => {
  const { rows } = await pool.query(`
    SELECT
      (SELECT count(*) FROM quotes) AS quotes,
      (SELECT count(*) FROM clients) AS clients,
      (SELECT count(*) FROM invoices) AS invoices,
      (SELECT coalesce(sum(total_ttc),0) FROM quotes WHERE status NOT IN ('declined','draft')) AS quotes_value,
      (SELECT coalesce(sum(total_ttc),0) FROM invoices) AS invoices_value,
      (SELECT count(*) FROM quotes WHERE status='draft') AS draft,
      (SELECT count(*) FROM quotes WHERE status='sent') AS sent,
      (SELECT count(*) FROM quotes WHERE status='accepted') AS accepted,
      (SELECT count(*) FROM quotes WHERE status='declined') AS declined,
      (SELECT count(*) FROM quotes WHERE status='invoiced') AS invoiced,
      (SELECT count(*) FROM invoices WHERE status='unpaid') AS unpaid,
      (SELECT count(*) FROM invoices WHERE status='paid') AS paid,
      (SELECT count(*) FROM invoices WHERE status='partial') AS partial,
      (SELECT coalesce(sum(total_ttc),0) FROM invoices) AS invoices_total,
      (SELECT coalesce(sum(total_ttc),0) FROM invoices WHERE status='paid') AS received_total,
      (SELECT coalesce(sum(total_ttc),0) FROM invoices WHERE status IN ('unpaid','partial')) AS pending_total,
      (SELECT coalesce(sum(total_ttc),0) FROM quotes WHERE status='accepted') AS accepted_value,
      (SELECT coalesce(sum(total_ttc),0) FROM invoices WHERE issue_date >= date_trunc('month', CURRENT_DATE)) AS month_invoiced,
      (SELECT count(*) FROM invoices WHERE issue_date >= date_trunc('month', CURRENT_DATE)) AS month_count,
      (SELECT coalesce(sum(paid),0) FROM (
         SELECT i.id, coalesce((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid
         FROM invoices i
       ) x) AS payments_total_total
  `);
  const s = rows[0];
  const decided = (Number(s.accepted) || 0) + (Number(s.sent) || 0) + (Number(s.declined) || 0) + (Number(s.invoiced) || 0);
  s.acceptance_rate = decided > 0 ? Math.round((((Number(s.accepted) || 0) + (Number(s.invoiced) || 0)) / decided) * 100) : 0;
  s.overdue = (await pool.query(
    `SELECT i.id, i.number, i.status, i.due_date, i.total_ttc,
            coalesce((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid,
            c.name AS client
       FROM invoices i
       LEFT JOIN quotes q ON q.id = i.quote_id
       LEFT JOIN clients c ON c.id = COALESCE(i.client_id, q.client_id)
      WHERE i.status IN ('unpaid','partial') AND i.due_date < CURRENT_DATE
      ORDER BY i.due_date ASC LIMIT 10`,
  )).rows;
  s.expiring_quotes = (await pool.query(
    `SELECT q.id, q.number, q.status, q.valid_until, q.total_ttc, c.name AS client
       FROM quotes q
       LEFT JOIN clients c ON c.id = q.client_id
      WHERE q.status = 'sent' AND q.valid_until >= CURRENT_DATE AND q.valid_until <= CURRENT_DATE + INTERVAL '15 days'
      ORDER BY q.valid_until ASC LIMIT 10`,
  )).rows;
  s.recent_invoices = (await pool.query(
    `SELECT i.id, i.number, i.status, i.due_date, i.total_ttc,
            coalesce((SELECT sum(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid,
            c.name AS client
       FROM invoices i
       LEFT JOIN quotes q ON q.id = i.quote_id
       LEFT JOIN clients c ON c.id = COALESCE(i.client_id, q.client_id)
      ORDER BY i.id DESC LIMIT 8`,
  )).rows;
  return c.json(s);
});

/* ---------- Devis public (lien de validation) ---------- */
async function validShareSig(id, sig) {
  const expected = await hmacHex(SESSION_SECRET, `verify:${id}`);
  return timingSafeEqual(expected, String(sig || ""));
}

app.get("/api/public/quote/:id/info", async (c) => {
  const id = Number(c.req.param("id"));
  if (!(await validShareSig(id, c.req.query("sig")))) {
    return c.json({ error: "Lien invalide ou expiré" }, 403);
  }
  const q = await getQuote(id);
  if (!q) return c.json({ error: "Devis introuvable" }, 404);
  const company = await loadCompany();
  return c.json({
    number: q.number,
    status: q.status,
    accepted: q.status === "accepted" || q.status === "invoiced",
    invoiced: q.status === "invoiced",
    issue_date: q.issue_date,
    valid_until: q.valid_until,
    total_ht: q.total_ht,
    total_tva: q.total_tva,
    total_ttc: q.total_ttc,
    conditions: q.conditions,
    notes: q.notes,
    client: q.client ? { name: q.client.name } : null,
    has_email: !!(q.client && String(q.client.email || "").trim()),
    pdf_url: `/api/pdf-share/quote/${id}/${await pdfShareToken("quote", id)}`,
    items: (q.items || []).map((it) => ({
      description: it.description, quantity: it.quantity, unit_price: it.unit_price, tva_rate: it.tva_rate,
    })),
    company: { name: company.name || "PaletteD&co", phone: company.phone, email: company.email },
  });
});

app.post("/api/public/quote/:id/accept", async (c) => {
  const id = Number(c.req.param("id"));
  let body: any = {};
  try {
    body = await c.req.json();
  } catch {
    /* corps absent */
  }
  if (!(await validShareSig(id, body.sig))) {
    return c.json({ error: "Lien invalide" }, 403);
  }
  const q = (await pool.query("SELECT * FROM quotes WHERE id = $1", [id])).rows[0];
  if (!q) return c.json({ error: "Devis introuvable" }, 404);
  if (q.status === "accepted" || q.status === "invoiced") {
    return c.json({ ok: false, already: true, number: q.number });
  }
  if (q.status === "declined") {
    return c.json({ error: "Ce devis a été refusé et ne peut plus être accepté." }, 409);
  }

  /* E-mail du client : celui que nous avons en base, ou celui fourni par le
     client. Si nous n'avons pas d'adresse, on demande la sienne avant de
     valider : l'acceptation n'est enregistree que si un e-mail existe. */
  const provided = String(body.email || "").trim();
  const client = q.client_id ? (await pool.query("SELECT email FROM clients WHERE id = $1", [q.client_id])).rows[0] : null;
  const current = client && String(client.email || "").trim();
  const targetEmail = provided || current;
  if (!targetEmail) {
    return c.json({ ok: false, email_required: true }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(targetEmail)) {
    return c.json({ error: "Veuillez saisir une adresse e-mail valide." }, 400);
  }

  if (provided && provided !== current) {
    await pool.query("UPDATE clients SET email = $1 WHERE id = $2", [provided, q.client_id]);
  }
  await pool.query("UPDATE quotes SET status = 'accepted', updated_at = now() WHERE id = $1", [id]);

  /* Envoi du devis par e-mail (meilleur effort : l'acceptation reste acquise
     meme si l'envoi echoue). En mode Test, le message part vers l'adresse de
     test au lieu du client. */
  let email_sent = false;
  let redirected = false;
  let mode: string | null = null;
  let email_error = "";
  try {
    const r = await emailDocument({ type: "quote", id, to: targetEmail });
    if (r.ok) {
      email_sent = true;
      redirected = !!r.redirected;
      mode = r.mode || null;
    } else if (r.blocked === "NO_TEST_EMAIL") {
      email_error = "Envoi bloqué : mode test actif mais aucune adresse de test renseignée.";
    } else if ((r as { error?: string }).error) {
      email_error = String((r as { error?: string }).error);
    }
  } catch (e) {
    email_error = (e as Error).message;
  }
  return c.json({ ok: true, number: q.number, email_sent, redirected, mode, email_error });
});

/* ---------- Envoi email (Brevo / Resend) ---------- */
let brevoSendersCache: string[] | null | undefined;
async function brevoValidatedSender(prefer: string): Promise<string | null> {
  if (brevoSendersCache === undefined) {
    try {
      const res = await fetch("https://api.brevo.com/v3/senders", {
        headers: { "api-key": BREVO_API_KEY },
      });
      if (!res.ok) {
        brevoSendersCache = null;
      } else {
        const j = (await res.json()) as { senders?: { email: string; active?: boolean }[] };
        brevoSendersCache = (j.senders || []).filter((s) => s.active !== false).map((s) => s.email);
      }
    } catch {
      brevoSendersCache = null;
    }
  }
  const list = brevoSendersCache;
  if (!list || !list.length) return null;
  if (prefer && list.includes(prefer)) return prefer;
  return list.find((e) => /@(gmail|outlook|hotmail)\.com$/i.test(e)) || list[0] || null;
}

function emailFailureDetail(j: Record<string, unknown>) {
  const msg = String((j as { message?: unknown }).message || "").toLowerCase();
  if (msg.includes("sender") && /(not )?verif|sender.*valid|invalid sender|expéditeur/i.test(msg)) {
    return {
      status: 502,
      body: {
        error: "EMAIL_SENDER_NOT_VALIDATED",
        hint:
          "L'expéditeur défini (EMAIL_FROM) n'est pas validé chez Brevo. Dans Brevo : Réglages → Expéditeurs et IP → « Ajouter un expéditeur » avec l'adresse concernée, puis saisir le code reçu par e-mail. Voir https://app.brevo.com/senders",
        detail: j.message,
      },
    };
  }
  return { status: 502, body: { error: "EMAIL_FAILED", detail: j.message || "erreur inconnue", code: (j as { code?: unknown }).code } };
}
/* Envoi d'un document (devis/facture/commande) par e-mail, avec le PDF joint.
   Partage le rendu (objet, texte, piece jointe, garde-fou Mode Test) entre
   /api/send-document et l'acceptation publique d'un devis. */
async function emailDocument(args: { type: "quote" | "order" | "invoice"; id: number; to: string; copy?: boolean }) {
  const type = args.type;
  const id = Number(args.id);
  const doc = await getDoc(type, id);
  if (!doc) return { error: "Document introuvable" };
  const requested = String(args.to || "").trim();
  if (!requested) return { error: "EMAIL_MISSING" };
  if (!BREVO_API_KEY && !RESEND_API_KEY) return { error: "EMAIL_NOT_CONFIGURED" };

  /* Garde-fou Mode Test : tant que le mode Reel n'est pas active explicitement,
     le message part vers l'adresse de test et jamais vers le client. */
  const settings = await loadAppSettings(pool);
  const { to, redirected, mode } = resolveRecipient(settings, requested);
  if (!to) return { blocked: "NO_TEST_EMAIL", redirected, mode };

  const company = await loadCompany();
  const safeFrom = (function () {
    const m = EMAIL_FROM.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
    return m ? { name: m[1] || company.name || "PaletteD&co", email: m[2] } : { name: company.name || "PaletteD&co", email: EMAIL_FROM };
  })();
  const cc = args.copy ? [{ email: safeFrom.email }] : [];
  const label = type === "invoice" ? "facture" : type === "order" ? "bon de commande" : "devis";
  const pdf = await buildDocumentPdf(type, id);
  if (!pdf) return { error: "PDF impossible" };
  const subject = (redirected ? "[TEST] " : "") + `${label === "facture" ? "Facture" : label === "bon de commande" ? "Bon de commande" : "Devis"} ${doc.number} - ${company.name || "PaletteD&co"}`;
  const text = [
    `Bonjour,`,
    ``,
    `Veuillez trouver en pièce jointe ${label === "facture" ? "la facture" : label === "bon de commande" ? "le bon de commande" : "le devis"} ${doc.number}.`,
    doc.client?.name ? `Client : ${doc.client.name}` : "",
    `Montant total TTC : ${moneyStr(doc.total_ttc)}`,
    ``,
    type === "quote" ? "N'hésitez pas à nous contacter pour toute question." : "",
    `Cordialement,`,
    `${company.name || "PaletteD&co"}${company.phone ? `\nTél. : ${company.phone}` : ""}${company.email ? `\nEmail : ${company.email}` : ""}`,
  ].filter(Boolean).join("\n");
  const pdfB64 = pdf.toString("base64");

  async function tryResend() {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [to],
        reply_to: safeFrom.email,
        subject,
        text,
        attachments: [{ filename: `${doc.number}.pdf`, content: pdfB64 }],
      }),
    });
    const j: Record<string, unknown> = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Resend : ${(j as { message?: unknown }).message || res.statusText}`);
    return (j as { id?: unknown }).id;
  }

  if (BREVO_API_KEY) {
    const sender = (await brevoValidatedSender(safeFrom.email)) || safeFrom.email;
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { name: company.name || safeFrom.name, email: sender },
        replyTo: { email: safeFrom.email, name: safeFrom.name },
        to: [{ email: to }],
        cc: cc.length ? cc : undefined,
        subject,
        textContent: text,
        attachment: [{ name: `${doc.number}.pdf`, content: pdfB64 }],
      }),
    });
    const j: Record<string, unknown> = await res.json().catch(() => ({}));
    if (!res.ok) {
      const f = emailFailureDetail(j);
      if (RESEND_API_KEY) {
        try {
          return { ok: true, via: "resend", id: await tryResend(), redirected, mode };
        } catch (e) {
          throw new Error(`Brevo : ${f.body.detail} | ${(e as Error).message}`);
        }
      }
      throw new Error(`Brevo : ${f.body.detail}`);
    }
    return { ok: true, via: "brevo", id: (j as { messageId?: unknown }).messageId, redirected, mode };
  }
  return { ok: true, via: "resend", id: await tryResend(), redirected, mode };
}

app.post("/api/send-document", async (c) => {
  const b = await c.req.json();
  const type = b.type === "invoice" ? "invoice" : b.type === "order" ? "order" : "quote";
  const id = Number(b.id);
  const doc = await getDoc(type, id);
  if (!doc) return c.json({ error: "Document introuvable" }, 404);
  const clientEmail = String((doc.client && doc.client.email) || "").trim();
  const requested = String(b.to || "").trim() || clientEmail;
  if (!requested) return c.json({ error: "Adresse e-mail du client manquante. Renseignez l'e-mail du client." }, 400);

  let r;
  try {
    r = await emailDocument({ type, id, to: requested, copy: !!b.copy });
  } catch (e) {
    return c.json({ error: "EMAIL_FAILED", detail: (e as Error).message }, 502);
  }
  if (r.error === "EMAIL_NOT_CONFIGURED") {
    return c.json({
      error: "EMAIL_NOT_CONFIGURED",
      hint: "Ajoutez BREVO_API_KEY (ou RESEND_API_KEY) et EMAIL_FROM (adresse vérifiée) pour activer l'envoi par email.",
    }, 400);
  }
  if (r.blocked === "NO_TEST_EMAIL") {
    return c.json({
      error: "Mode test actif mais aucune adresse de test renseignee : aucun envoi n'a ete effectue.",
      need_test_email: true,
    }, 400);
  }
  if (!r.ok) return c.json({ error: r.error || "EMAIL_FAILED" }, 400);
  return c.json({ ok: true, id: r.id, via: r.via, redirected: r.redirected, mode: r.mode });
});

/* ---------- PDF (téléchargement) ---------- */
app.get("/api/pdf/:type/:id", async (c) => {
  const type = c.req.param("type");
  if (!["quote", "invoice", "order"].includes(type)) return c.json({ error: "Type inconnu" }, 404);
  const id = Number(c.req.param("id"));
  const doc = await getDoc(type, id);
  if (!doc) return c.json({ error: "Document introuvable" }, 404);
  let buf;
  try {
    buf = await buildDocumentPdf(type, id);
  } catch (e) {
    return c.json({ error: `PDF impossible : ${e.message}` }, 500);
  }
  if (!buf) return c.json({ error: "PDF impossible" }, 500);
  c.header("Content-Type", "application/pdf");
  c.header("Content-Disposition", `inline; filename="${pdfFilename(doc, type, id)}"`);
  return c.body(new Uint8Array(buf));
});

/* ---------- PDF partageable (WhatsApp / lien public signé) ---------- */
async function pdfShareToken(type, id) {
  return hmacHex(PDF_SECRET, `pdf:${type}:${id}`);
}
async function validPdfToken(type, id, token) {
  const expected = await pdfShareToken(type, id);
  return timingSafeEqual(expected, String(token || ""));
}

app.get("/api/pdf-url/:type/:id", async (c) => {
  const type = c.req.param("type");
  const id = Number(c.req.param("id"));
  if (!["quote", "invoice", "order"].includes(type)) return c.json({ error: "Type inconnu" }, 404);
  const doc = await getDoc(type, id);
  if (!doc) return c.json({ error: "Document introuvable" }, 404);
  const token = await pdfShareToken(type, id);
  return c.json({ url: `/api/pdf-share/${type}/${id}/${token}` });
});

app.get("/api/pdf-share/:type/:id/:token", async (c) => {
  const type = c.req.param("type");
  const id = Number(c.req.param("id"));
  if (!["quote", "invoice", "order"].includes(type)) return c.json({ error: "Type inconnu" }, 404);
  if (!(await validPdfToken(type, id, c.req.param("token")))) {
    return c.json({ error: "Lien invalide ou expiré" }, 403);
  }
  const buf = await buildDocumentPdf(type, id);
  if (!buf) return c.json({ error: "PDF impossible" }, 500);
  const doc = await getDoc(type, id);
  c.header("Content-Type", "application/pdf");
  c.header("Content-Disposition", `inline; filename="${pdfFilename(doc, type, id)}"`);
  return c.body(new Uint8Array(buf));
});

/* ---------- Envoi d'e-mail partage (mode Test / mode Reel) ----------
   Toute sortie de l'application passe par sendMail() : le mode Test y
   redirige automatiquement vers l'adresse de test. */
async function sendMail(args: {
  to: string;
  subject: string;
  text: string;
  attachment?: { filename: string; content: string };
}): Promise<{ id?: string; via: string }> {
  if (!BREVO_API_KEY && !RESEND_API_KEY) {
    throw new Error("EMAIL_NOT_CONFIGURED : ajoutez BREVO_API_KEY ou RESEND_API_KEY.");
  }
  if (BREVO_API_KEY) {
    /* EMAIL_FROM vaut "Nom <adresse>" : Brevo exige sender.email, pas le nom
       seul. Sans cette extraction, toute relance echouait avec "One of sender
       email or sender ID is mandatory". */
    const m = EMAIL_FROM.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
    const safeFrom = m
      ? { name: m[1] || "PaletteD&co", email: m[2] }
      : { name: "PaletteD&co", email: EMAIL_FROM };
    let sender = { name: safeFrom.name, email: safeFrom.email };
    try {
      const validated = (await brevoValidatedSender(safeFrom.email)) || safeFrom.email;
      sender = { name: safeFrom.name, email: validated };
    } catch {
      /* en dernier recours on garde l'adresse configuree */
    }
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender,
        to: [{ email: args.to }],
        subject: args.subject,
        textContent: args.text,
        attachment: args.attachment
          ? { name: args.attachment.filename, content: args.attachment.content }
          : undefined,
      }),
    });
    const j: Record<string, unknown> = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Brevo : ${(j as { message?: unknown }).message || res.statusText}`);
    }
    return { id: (j as { messageId?: unknown }).messageId as string | undefined, via: "brevo" };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [args.to],
      subject: args.subject,
      text: args.text,
      attachments: args.attachment
        ? [{ filename: args.attachment.filename, content: args.attachment.content }]
        : undefined,
    }),
  });
  const j: Record<string, unknown> = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend : ${(j as { message?: unknown }).message || res.statusText}`);
  return { id: (j as { id?: unknown }).id as string | undefined, via: "resend" };
}

registerCockpit({ app, pool, loadCompany: () => loadCompany(), moneyStr, sendMail });

app.notFound((c) => c.json({ error: "Route introuvable" }, 404));

export default app;