/**
 * Chargeur d'environnement pour les scripts de developpement.
 *
 * Regle absolute : toute variable commencant par DATABASE_URL provient
 * EXCLUSIVEMENT de .env.dev. Le fichier .env.local sert pour les secrets
 * applicatifs (API_TOKEN, Brevo, Resend...), jamais pour la base de donnees.
 *
 *   import { loadDevEnv } from "./_dev-env.mjs";
 *   loadDevEnv();
 *
 * Charger .env.dev puis .env.local dans une boucle simple fait echouer la regle
 * ci-dessus : .env.local ecrase la base et les tests écrivent en production.
 * Ce module rend cette erreur impossible et verifie l'hote au lancement.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function parse(file) {
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** Retire les options de pooling : le driver Node n'accepte pas sslmode=require. */
const withoutOptions = (url) => String(url || "").replace(/options=[^ ]*/g, "");

export function loadDevEnv({ quiet = false } = {}) {
  const dev = parse(join(ROOT, ".env.dev"));
  const local = parse(join(ROOT, ".env.local"));

  /* 1. Base de donnees : .env.dev fait foi, meme si .env.local a ete lu. */
  const devPooled = withoutOptions(dev.DATABASE_URL);
  const devUnpooled = withoutOptions(dev.DATABASE_URL_UNPOOLED || dev.DATABASE_URL);
  if (!devPooled) throw new Error(".env.dev ne contient pas DATABASE_URL.");
  process.env.DATABASE_URL = devPooled;
  process.env.DATABASE_URL_UNPOOLED = devUnpooled;

  /* 2. Secrets applicatifs : .env.local complete, sans jamais ecraser la base. */
  for (const [k, v] of Object.entries(local)) {
    if (k.startsWith("DATABASE_URL")) continue;
    process.env[k] ??= v;
  }
  for (const [k, v] of Object.entries(dev)) {
    if (k.startsWith("DATABASE_URL")) continue;
    process.env[k] ??= v;
  }

  /* 3. Garde-fou : refuser de tourner si l'URL cible n'est pas celle du dev. */
  const devHost = new URL(devPooled).hostname;
  for (const k of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"]) {
    const host = new URL(process.env[k]).hostname;
    if (host !== devHost) {
      throw new Error(
        `ARRET : ${k} pointe sur ${host} au lieu de la base de dev (${devHost}). ` +
          `Ecriture interdite sur une autre base.`,
      );
    }
  }
  if (!quiet) {
    console.log(`Base de developpement : ${devHost} (pooled + unpooled, identiques)`);
  }
  return { devHost };
}