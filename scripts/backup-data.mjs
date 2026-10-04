#!/usr/bin/env node
/**
 * Sauvegarde / restaurationComplete des donnees PostgreSQL.
 *
 *   node scripts/backup-data.mjs --env .env.local --label prod
 *   node scripts/backup-data.mjs --restore backups/data/prod-2026-10-01.sql --env .env.dev --yes
 *
 * Pourquoi un script maison ? L'environnement ne dispose pas de pg_dump.
 * Le dump produit du SQL standard (CREATE TABLE + INSERT) que psql peut
 * aussi rejouer, avec les sequences positionnees a l'identique.
 *
 * Securite : ne restore jamais sur la production sans un --yes explicite
 * ET un --prod supplementaire, la restauration se fait dans une seule
 * transaction (rollback integral en cas d'erreur). La restauration vise
 * .env.dev par defaut : viser la production doit etre demande.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv(file) {
  const out = {};
  for (const line of readFileSync(resolve(root, file), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function clientFrom(urlString) {
  const u = new URL(urlString);
  return new Client({
    host: u.hostname,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1),
    ssl: { rejectUnauthorized: false },
    family: 4,
  });
}

const lit = (v) => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (Buffer.isBuffer(v)) return `'\\x${v.toString("hex")}'::bytea`;
  /* Le pilote pg transforme deja les colonnes json/jsonb en objets JS :
     sans JSON.stringify, un tableau [] devenait la chaine vide et la
     restauration echouait sur "invalid input syntax for type json". */
  if (typeof v === "object" && !(v instanceof Date)) return lit(JSON.stringify(v));
  if (v instanceof Date) return `'${v.toISOString()}'`;
  const s = String(v).replace(/\\/g, "\\\\").replace(/'/g, "''").replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
  return `'${s}'`;
};

async function dump(envFile, label) {
  const env = loadEnv(envFile);
  const c = clientFrom(env.DATABASE_URL_UNPOOLED || env.DATABASE_URL);
  await c.connect();
  const tables = (
    await c.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name",
    )
  ).rows.map((r) => r.table_name);

  /* Les sequences doivent etre recreees avant les tables : une colonne
     "serial" declaree en base porte un DEFAULT nextval('...'), qui echoue si la
     sequence n'existe pas. Sans ce bloc, la restauration s'arretait sur
     "relation clients_id_seq does not exist". */
  const sequences = (
    await c.query(
      "SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'S' AND n.nspname = 'public' ORDER BY c.relname",
    )
  ).rows.map((r) => r.name);

  const stamp = new Date().toISOString().slice(0, 10);
  const out = join(root, "backups", "data", `${label}-${stamp}.sql`);
  mkdirSync(dirname(out), { recursive: true });

  let sql = `-- Sauvegarde complete ${label} — ${new Date().toISOString()}\n`;
  sql += `-- Restauration : node scripts/backup-data.mjs --restore ${out.slice(root.length + 1)} --yes\n`;
  sql += `SET client_encoding = 'UTF8';\nSET standard_conforming_strings = on;\nBEGIN;\n`;

  for (const s of sequences) sql += `\nCREATE SEQUENCE IF NOT EXISTS "${s}";\n`;
  if (sequences.length) sql += `\n-- ---------- sequences (${sequences.length}) ----------\n`;

  for (const t of tables) {
    const cols = (
      await c.query(
        `SELECT column_name, data_type, column_default, is_nullable
         FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
        [t],
      )
    ).rows;
    const defs = cols
      .map((col) => {
        const type = /^(smallint|integer|bigint)$/.test(col.data_type) ? "bigint" : col.data_type;
        const def = col.column_default ? ` DEFAULT ${col.column_default}` : "";
        return `  "${col.column_name}" ${type}${def}${col.is_nullable === "NO" ? " NOT NULL" : ""}`;
      })
      .join(",\n");
    sql += `\n-- ---------- ${t} ----------\nDROP TABLE IF EXISTS "${t}" CASCADE;\nCREATE TABLE "${t}" (\n${defs}\n);\n`;

    /* Les colonnes date/timestamp sans fuseau sont lues en texte par le SQL :
       le pilote les convertit sinon en Date (decalees d'un jour en UTC) et le
       dump ne restituerait plus la valeur stockee. */
    const selectList = cols
      .map((col) => {
        const n = `"${col.column_name}"`;
        if (/^date$/.test(col.data_type)) return `to_char(${n}, 'YYYY-MM-DD') AS ${n}`;
        if (/^timestamp without time zone$/.test(col.data_type)) return `to_char(${n}, 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS ${n}`;
        return n;
      })
      .join(", ");
    /* ORDER BY id obligatoire : sans lui PostgreSQL renvoie les lignes dans
       un ordre arbitraire et le setval() plus bas positionne la sequence sur
       la derniere ligne du scan au lieu du plus grand id. Les identifiants
       suivants entraient alors en collision avec une ligne existante. */
    const rows = (await c.query(`SELECT ${selectList} FROM "${t}" ORDER BY id`)).rows;
    if (rows.length) {
      const names = cols.map((col) => `"${col.column_name}"`).join(", ");
      for (const row of rows) {
        /* json / jsonb exigent un cast explicite : sans lui, PostgreSQL lit la
           chaine comme du texte et echoue ("invalid input syntax for type json"). */
        const values = cols
          .map((col) => {
            const v = lit(row[col.column_name]);
            return /^(json|jsonb)$/.test(col.data_type) && v !== "NULL" ? `${v}::${col.data_type}` : v;
          })
          .join(", ");
        sql += `INSERT INTO "${t}" (${names}) VALUES (${values});\n`;
      }
    }
    for (const col of cols) {
      const seq = col.column_default && String(col.column_default).match(/nextval\('([^']+)'/);
      /* setval uniquement sur une colonne numerique : on ne peut pas faire
         ('texte')::bigint. */
      if (seq && /^(smallint|integer|bigint)$/.test(col.data_type)) {
        const last = rows.length ? rows[rows.length - 1][col.column_name] : null;
        if (last !== null && last !== undefined && Number.isFinite(Number(last))) {
          sql += `SELECT setval('${seq[1]}', ${Number(last)}, true);\n`;
        } else {
          sql += `SELECT setval('${seq[1]}', 1, false);\n`;
        }
      }
    }
    sql += `-- ${rows.length} ligne(s) dans ${t}\n`;
  }
  sql += "\nCOMMIT;\n";
  await c.end();
  writeFileSync(out, sql);
  console.log(`[backup] ${out.replace(root + "/", "")} (${(sql.length / 1024).toFixed(1)} Ko)`);
  return out;
}

async function restore(file, confirmed, envFile) {
  if (!confirmed) {
    console.error("Refus : ajouter --yes pour confirmer l'ecrasement des donnees de cette base.");
    process.exit(1);
  }
  const env = loadEnv(envFile);
  const url = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
  /* Un restore execute sur le mauvais environnement detruit la base ciblee :
     le fichier .env.local porte l'URL de production, on exige donc un
     environnement cible explicite et on refuse la production sans --prod. */
  const isProd = /neon\.tech|prod/i.test(url) || envFile === ".env.local";
  if (isProd && !args.includes("--prod")) {
    console.error(`Refus : ${envFile} pointe vers une base de production (${new URL(url).hostname}).`);
    console.error("Utiliser --env .env.dev pour la restauration, ou ajouter --prod si c'est voulu.");
    process.exit(1);
  }
  console.error(`[restore] cible ${new URL(url).hostname}/${new URL(url).pathname.slice(1)} (${envFile})`);
  const c = clientFrom(url);
  await c.connect();
  const sql = readFileSync(resolve(root, file), "utf8");
  try {
    await c.query(sql);
    console.log("[restore] OK — transaction validee.");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("[restore] ECHEC, transaction annulee :", e.message);
    process.exit(1);
  }
  await c.end();
}

const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
if (args.includes("--restore")) {
  await restore(
    arg("--restore", ""),
    args.includes("--yes"),
    arg("--env", ".env.dev"),
  );
} else {
  await dump(arg("--env", ".env.local"), arg("--label", "dump"));
}