/**
 * Conversion des couleurs codees en dur vers les jetons de theme.
 *
 * L'application utilisait des classes du type bg-[#251710], text-stone-400,
 * border-white/10... qui ne fonctionnent qu'en sombre. On les remplace une
 * seule fois par bg-surface, text-ink-3, border-line : ces noms sont
 * independants du theme (voir app/src/index.css).
 *
 * Usage : node scripts/theme-tokens.mjs [--check]
 *   --check : ne modifie rien, compte ce qui reste a convertir.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "app", "src");

/* L'ordre compte : les motifs les plus specifiques d'abord. */
const RULES = [
  // --- accent (teal) ---
  ["bg-[#14b8a6]/10", "bg-accent/10"],
  ["bg-[#14b8a6]/15", "bg-accent/15"],
  ["bg-[#14b8a6]/20", "bg-accent/20"],
  ["hover:bg-[#14b8a6]/30", "hover:bg-accent/30"],
  ["bg-[#14b8a6]", "bg-accent"],
  ["hover:bg-[#0fb69f]", "hover:bg-accent-hover"],
  ["text-[#0c1413]", "text-accent-ink"],
  ["border-[#14b8a6]/40", "border-accent/40"],
  ["text-[#14b8a6]", "text-accent"],
  ["bg-[#0f766e]", "bg-accent-hover"],

  // --- surfaces ---
  ["bg-[#251710]", "bg-surface"],
  ["bg-[#2a1b10]", "bg-surface-2"],
  ["bg-[#271a10]", "bg-surface-2"],
  ["bg-[#3c2a1a]", "bg-surface-3"],
  ["hover:bg-[#4a3524]", "hover:bg-surface-3"],
  ["bg-[#1f150d]", "bg-surface-2"],
  ["bg-[#1c130c]/95", "bg-app/95"],
  ["bg-[#1c130c]/80", "bg-app/80"],
  ["bg-[#1c130c]", "bg-app"],

  // --- texte ---
  ["text-[#f5efe6]", "text-ink"],
  ["text-white", "text-ink"],
  ["text-stone-100", "text-ink"],
  ["text-stone-200", "text-ink"],
  ["text-stone-300", "text-ink-2"],
  ["text-stone-400", "text-ink-3"],
  ["text-stone-500", "text-ink-4"],
  ["text-stone-600", "text-ink-4"],
  ["text-stone-700", "text-ink-3"],
  ["text-stone-800", "text-ink-2"],
  ["placeholder-stone-500", "placeholder-ink-4"],
  ["placeholder-stone-600", "placeholder-ink-4"],

  // --- bordures et aplats ---
  ["border-white/10", "border-line"],
  ["border-white/15", "border-line-2"],
  ["border-stone-200", "border-line-2"],
  ["divide-white/5", "divide-line"],
  ["hover:bg-white/10", "hover:bg-hover"],
  ["hover:bg-white/5", "hover:bg-subtle"],
  ["bg-white/10", "bg-hover"],
  ["bg-white/5", "bg-subtle"],

  // --- succes ---
  ["bg-emerald-500/15", "bg-success-soft"],
  ["bg-emerald-500/10", "bg-success-soft"],
  ["border-emerald-500/40", "border-success-line"],
  ["border-emerald-500/30", "border-success-line"],
  ["text-emerald-300", "text-success"],
  ["text-emerald-400", "text-success"],

  // --- danger ---
  ["bg-red-500/10", "bg-danger-soft"],
  ["bg-red-500/15", "bg-danger-soft"],
  ["border-red-500/40", "border-danger-line"],
  ["border-red-500/30", "border-danger-line"],
  ["text-red-300", "text-danger"],
  ["text-red-200", "text-danger"],
  ["text-red-400", "text-danger"],
  ["hover:bg-red-500/20", "hover:bg-danger-soft"],

  // --- ambre / bois ---
  ["text-amber-300", "text-brand-2"],
  ["text-amber-400", "text-brand-2"],
  ["bg-amber-500/10", "bg-brand-soft"],
  ["bg-amber-500/15", "bg-brand-soft"],
  ["border-amber-500/40", "border-brand-line"],
  ["border-amber-500/30", "border-brand-line"],
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(tsx|ts)$/.test(name)) out.push(p);
  }
  return out;
}

const check = process.argv.includes("--check");
let totalHits = 0;
const leftovers = [];

for (const file of walk(root)) {
  let src = readFileSync(file, "utf8");
  const before = src;
  let hits = 0;
  for (const [from, to] of RULES) {
    const parts = src.split(from);
    if (parts.length > 1) {
      hits += parts.length - 1;
      src = parts.join(to);
    }
  }
  if (src !== before) {
    totalHits += hits;
    if (check) console.log(`[check] ${relative(root, file)} : ${hits} occurrence(s)`);
    else writeFileSync(file, src);
  }
  const still = src.match(/(?:bg|text|border|divide|from|to|ring|placeholder)-(?:#[0-9a-fA-F]{3,8}|stone-\d{2,3}|white\/\d+|emerald-\d{3}|red-\d{3}|amber-\d{3})/g);
  if (still) leftovers.push([relative(root, file), [...new Set(still)]]);
}

console.log(check ? `Total a convertir : ${totalHits}` : `${totalHits} occurrence(s) convertie(s)`);
if (leftovers.length) {
  console.log("\nClasses en dur restantes (volontaires : couleurs du document papier) :");
  for (const [f, list] of leftovers) console.log(`  ${f} : ${list.join(", ")}`);
}
