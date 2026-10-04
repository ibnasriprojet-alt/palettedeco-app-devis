/**
 * Applique un script SQL de schema sur Neon.
 *
 * Regle du projet : toute migration doit etre 100% additive.
 * Ce runner refuse donc le fichier si un ordre destructif est detecte
 * (DROP / DELETE / TRUNCATE), ce qui protege les donnees de production.
 *
 *   node scripts/migrate.mjs                       # sql/schema.sql (base)
 *   node scripts/migrate.mjs sql/migrations/003-cockpit.sql
 *   node scripts/migrate.mjs <fichier> --check     # analyse seule, n'ecrit rien
 *   node scripts/migrate.mjs <fichier> --env=.env.dev
 */
import { readFile } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv(file) {
  const path = join(root, file);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const args = process.argv.slice(2);
const envFlag = args.find((a) => a.startsWith("--env="));
loadEnv(envFlag ? envFlag.slice(6) : ".env.local");

const target = args.find((a) => !a.startsWith("--")) ?? join("sql", "schema.sql");
const checkOnly = args.includes("--check");

/** Neutralise ce qui n'est pas un ordre destructif : commentaires, chaines, clauses ON DELETE. */
export function stripNoise(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/\bON\s+DELETE\s+(?:SET\s+NULL|CASCADE|RESTRICT|NO\s+ACTION|SET\s+DEFAULT)\b/gi, " ")
    .replace(/\bDEFAULT\s+'[^']*'/gi, " ");
}

const DESTRUCTIVE = /\b(DROP|DELETE|TRUNCATE)\b/gi;

function analyze(sql) {
  const cleaned = stripNoise(sql);
  const statements = cleaned
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  const problems = [];
  for (const st of statements) {
    const found = st.match(DESTRUCTIVE);
    if (found) problems.push({ keyword: [...new Set(found.map((f) => f.toUpperCase()))], sql: st.slice(0, 120) });
  }
  return { problems, statements: statements.length };
}

const path = resolve(root, target);
const sql = await readFile(path, "utf8");
const { problems, statements } = analyze(sql);

const summary = {
  file: basename(path),
  tables: [...sql.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\w+)/gi)].map((m) => m[1]),
  columns: [...sql.matchAll(/ADD COLUMN(?:\s+IF NOT EXISTS)?\s+(\w+)/gi)].map((m) => m[1]),
  indexes: [...sql.matchAll(/CREATE INDEX(?:\s+IF NOT EXISTS)?\s+(\w+)/gi)].map((m) => m[1]),
  statements,
};

console.log(`Migration : ${summary.file}`);
console.log(`  ${statements} instructions | ${summary.tables.length} tables | ${summary.columns.length} colonnes | ${summary.indexes.length} index`);

if (problems.length) {
  console.error("\nREFUSEE - ordres destructifs detectes :");
  for (const p of problems) console.error(`  ${p.keyword.join("/")} : ${p.sql.replace(/\s+/g, " ")}`);
  console.error("\nLes migrations de ce projet doivent rester additives (aucun DROP/DELETE/TRUNCATE).");
  process.exit(1);
}

console.log("  Controle additif : OK (aucun DROP / DELETE / TRUNCATE)");

if (checkOnly) {
  console.log("\nMode --check : aucune connexion, rien n'a ete ecrit.");
  process.exit(0);
}

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("\nDATABASE_URL manquant dans le fichier d'environnement.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");
  console.log(`\nApplique sur ${process.env.ENV_NAME || "la base cible"} (transaction commitee).`);
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(`\nECHEC, transaction annulee : ${e.message}`);
  process.exit(1);
} finally {
  await client.end();
}