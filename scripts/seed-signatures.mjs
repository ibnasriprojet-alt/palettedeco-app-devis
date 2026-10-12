/**
 * Charge les signatures fournies (assets/signatures/*.png) dans la table
 * `signatories`. Idempotent : reexecute sans creer de doublon (repere par nom).
 *
 *   node scripts/seed-signatures.mjs                 # .env.local
 *   node scripts/seed-signatures.mjs --env=.env.dev
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFlag = process.argv.find((a) => a.startsWith("--env="));
const envFile = envFlag ? envFlag.slice(6) : ".env.local";
for (const line of readFileSync(join(root, envFile), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const SIGNATURES = [
  { file: "patron.png", name: "Patron", role: "Gérant" },
  { file: "fatou.png", name: "Fatou", role: "Couturière" },
  { file: "nasri.png", name: "Nasri", role: "" },
];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
try {
  let order = Number((await pool.query("SELECT COALESCE(MAX(sort_order), -1) AS m FROM signatories")).rows[0].m) + 1;
  for (const s of SIGNATURES) {
    const exists = (await pool.query("SELECT id FROM signatories WHERE name = $1", [s.name])).rows[0];
    if (exists) {
      console.log(`= ${s.name} : deja present (id ${exists.id})`);
      continue;
    }
    const png = readFileSync(join(root, "assets", "signatures", s.file));
    const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
    const { rows } = await pool.query(
      "INSERT INTO signatories (name, role, image, active, sort_order) VALUES ($1,$2,$3,true,$4) RETURNING id",
      [s.name, s.role, dataUrl, order++],
    );
    console.log(`+ ${s.name} ajoute (id ${rows[0].id}, ${Math.round(png.length / 1024)} Ko)`);
  }
  const all = await pool.query("SELECT id, name, role, active FROM signatories ORDER BY sort_order, id");
  console.log("\nSignataires :", all.rows.map((r) => `${r.id}:${r.name}`).join(", "));
} finally {
  await pool.end();
}
