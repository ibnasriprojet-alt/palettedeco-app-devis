process.loadEnvFile(".env.local");
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL ?? process.argv[3];
const backupName = process.argv[2];
if (!url || !backupName) {
  console.error("Usage: node backups/restore.mjs <BackupName> [DATABASE_URL]  (ex: node backups/restore.mjs 2026-09-25T21-40-00)");
  process.exit(1);
}

const dir = join(here, backupName);
const summary = JSON.parse(readFileSync(join(dir, "_manifest.json"), "utf8"));
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

await pool.query("BEGIN");
try {
  for (const t of Object.keys(summary)) {
    const rows = JSON.parse(readFileSync(join(dir, `${t}.json`), "utf8"));
    await pool.query(`TRUNCATE ${t} RESTART IDENTITY CASCADE`);
    if (rows.length) {
      const cols = Object.keys(rows[0]);
      const ph = cols.map((_, i) => `$${i + 1}`).join(", ");
      const ins = `INSERT INTO ${t} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${ph})`;
      for (const r of rows) await pool.query(ins, cols.map((c) => r[c]));
    }
    console.log(`restored ${t} (${rows.length} rows)`);
  }
  await pool.query("COMMIT");
  console.log("Restore OK");
} catch (e) {
  await pool.query("ROLLBACK");
  console.error("Restore FAILED:", e.message);
  process.exit(1);
}
await pool.end();