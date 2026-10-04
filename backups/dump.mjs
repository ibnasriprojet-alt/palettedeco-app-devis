process.loadEnvFile(".env.local");
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL ?? process.argv[2];
if (!url) {
  console.error("Usage: node backups/dump.mjs [DATABASE_URL]  (ou env DATABASE_URL)");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const tables = (
  await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`
  )
).rows.map((r) => r.table_name);

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dir = join(here, stamp);
mkdirSync(dir, { recursive: true });

const summary = {};
for (const t of tables) {
  const { rows } = await pool.query(`SELECT * FROM ${t} ORDER BY 1`);
  writeFileSync(join(dir, `${t}.json`), JSON.stringify(rows, null, 0));
  summary[t] = rows.length;
}

writeFileSync(join(dir, "_manifest.json"), JSON.stringify(summary, null, 2));
console.log(`Backup OK → ${dir}`);
console.table(summary);
await pool.end();