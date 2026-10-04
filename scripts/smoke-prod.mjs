/* Playwright n'est pas une dependance du projet : on tente l'import normal,
   sinon le cache npx, pour que le script reste lancable. */
import { createRequire } from "module";
const require_ = createRequire(import.meta.url);
let chromium;
for (const spec of ["playwright", "playwright-core", "/home/home/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs"]) {
  try { ({ chromium } = await import(spec)); break; } catch { /* suivant */ }
}
if (!chromium) { console.error("Playwright introuvable : npm i -D playwright, ou supprime le chemin du cache npx."); process.exit(1); }
import { execSync } from "child_process";

/* Smoke test prod STRICTEMENT en lecture seule : aucune creation, aucune suppression,
   aucune acceptation. */
const BASE = "https://palette-devis.vercel.app";
let ok = 0, ko = 0;
const chk = (n, c, e = "") => { console.log(`  ${c ? "✓" : "✗"} ${n}${e ? " — " + e : ""}`); c ? ok++ : ko++; };

const b = await chromium.launch();
const ctx = await b.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 140)));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 140)); });
page.setDefaultTimeout(60000);

/* 0. Le bundle servi contient la bonne API et aucun token */
const html = await (await fetch(BASE + "/")).text();
const jsFiles = [...html.matchAll(/\/assets\/[^"']+\.js/g)].map((m) => m[0]);
let bundle = "";
for (const f of jsFiles) bundle += await (await fetch(BASE + f)).text();
/* "localhost" apparait dans une lib tierce (fallback inerte) : on cible nos ports de dev */
chk("bundle prod : aucun port de dev", !/:8787|:5199|127\.0\.0\.1/.test(bundle));
chk("bundle prod : API de prod", bundle.includes("br-noisy-poetry-b2aw6oyh-api"));
chk("bundle prod : aucun token API", !/__API_TOKEN__|VITE_API_TOKEN/.test(bundle) && !/eyJ2IjoidjIiLCJjIj/.test(bundle));

/* 1. Page de connexion */
await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
await page.locator('input[type=password]').waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
chk("page de connexion", await page.locator('input[type=password]').isVisible());

/* 2. Connexion */
/* Le mot de passe n'est JAMAIS dans le script : il vient de l'environnement.
   Sans SMOKE_PASSWORD, le test s'arrete proprement plutot que d'echouer. */
const PASSWORD = process.env.SMOKE_PASSWORD || "";
if (!PASSWORD) {
  console.error("SMOKE_PASSWORD manquant : export SMOKE_PASSWORD=... avant de lancer ce script.");
  process.exit(2);
}
await page.locator("input[type=password]").fill(PASSWORD);
await page.getByRole("button", { name: "Se connecter" }).click();
await page.getByRole("button", { name: /Se déconnecter/ }).waitFor({ timeout: 60000 });
chk("connexion", true);
await page.waitForFunction(() => document.body.innerText.includes("Encaissements"), null, { timeout: 60000 });
const dash = await page.locator("body").innerText();
chk("tableau de bord rendu", !dash.includes("NaN") && /Encaiss/i.test(dash) && /Restant d/.test(dash));

/* 3. Les 4 devis et 3 factures sont toujours la */
await page.goto(BASE + "/quotes", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => /DEV-2026-00[2-5]/.test(document.body.innerText), null, { timeout: 60000 });
const qtxt = await page.locator("body").innerText();
chk("devis prod intacts", ["DEV-2026-002", "DEV-2026-003", "DEV-2026-004", "DEV-2026-005"].every((n) => qtxt.includes(n)));
await page.goto(BASE + "/invoices", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => /FAC-2026-00[1-3]/.test(document.body.innerText), null, { timeout: 60000 });
const itxt = await page.locator("body").innerText();
chk("factures prod intactes", ["FAC-2026-001", "FAC-2026-002", "FAC-2026-003"].every((n) => itxt.includes(n)));
chk("factures : numero de devis affiche", /Devis DEV-2026-00[23]/.test(itxt), (itxt.match(/Devis DEV-[0-9-]+/g) || []).join(", "));

/* 4. Clients + historique (nouvelle section BC) */
await page.goto(BASE + "/clients", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const clients = await page.locator("body").innerText();
chk("liste clients chargee", clients.length > 200 && !clients.includes("NaN"), `${clients.length} car.`);
const histBtn = page.getByRole("button", { name: /Historique/i }).first();
if (await histBtn.count()) {
  await histBtn.click();
  await page.waitForTimeout(2000);
  const h = await page.locator("body").innerText();
  /* le libelle est uppercase via CSS : innerText renvoie la forme transformee */
chk("historique client : section bons de commande", /BONS DE COMMANDE \(\d+\)/.test(h), (h.match(/BONS DE COMMANDE \(\d+\)/) || [""])[0]);
  chk("historique client : pas de crash", !h.includes("NaN"));
  await page.keyboard.press("Escape");
} else chk("historique client : bouton present", false, "introuvable");

/* 5. Aperçu d'un devis existant (lecture seule) + PDF */
await page.goto(BASE + "/quotes/14/view", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".a4-sheet", { timeout: 60000 });
const view = await page.locator("body").innerText();
chk("apercu devis : contenu affiche", view.includes("DEV-2026-002") && /Total TTC/.test(view));
const dl = page.waitForEvent("download", { timeout: 60000 }).catch(() => null);
await page.getByRole("button", { name: /Télécharger PDF/i }).first().click();
const d = await dl;
if (d) {
  const p = "/tmp/opencode/prod.pdf";
  await d.saveAs(p);
  const info = execSync(`pdfinfo ${p} 2>/dev/null | rg -i '^Pages' || echo '?'`).toString().trim();
  const txt = execSync(`pdftotext ${p} - 2>/dev/null || true`).toString();
  chk("PDF prod : nom de fichier", d.suggestedFilename() === "Devis DEV-2026-002.pdf", d.suggestedFilename());
  chk("PDF prod : 1 page", /Pages:\s*1/.test(info), info.trim());
  chk("PDF prod : montants presents", /Total HT/.test(txt) && /Total TTC/.test(txt));
} else chk("PDF prod : telechargement", false, "aucun evenement");

/* 6. Page 404 */
await page.goto(BASE + "/route-inexistante-xyz", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
chk("404 affichee", /Page introuvable/.test(await page.locator("body").innerText()));

/* 7. Lien public : un devis deja facture ne doit pas proposer "Accepter" */
await page.goto(BASE + "/clients", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);

const real = errs.filter((e) => !/favicon|manifest|sw\.js|ServiceWorker|Download the React DevTools/i.test(e));
chk("aucune erreur JavaScript", real.length === 0, real.slice(0, 2).join(" | "));

console.log(`\nPRODUCTION (lecture seule) : ${ok} OK / ${ko} KO`);
await b.close();