import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadLocalEnv() {
  const out = {};
  try {
    const file = readFileSync(join(root, ".env.local"), "utf8");
    for (const line of file.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
      if (m) out[m[1]] = m[2];
    }
  } catch {
    /* ignore */
  }
  return out;
}

const env = loadLocalEnv();
const token = env.API_TOKEN;
const urlIdx = process.argv.indexOf("--url");
const url =
  (urlIdx !== -1 ? process.argv[urlIdx + 1] : "") ||
  env.VITE_API_URL ||
  "";

if (!token) {
  console.error("API_TOKEN introuvable dans .env.local");
  process.exit(1);
}
if (!url) {
  console.error(
    "URL de l'API manquante. Utilisez : node scripts/build-web.mjs --url <URL_ONDE>",
  );
  process.exit(1);
}

const cmd = `npm run build`;
console.log(`[build-web] VITE_API_URL=${url}`);
execSync(cmd, {
  cwd: join(root, "app"),
  env: { ...process.env, VITE_API_URL: url, VITE_API_TOKEN: token },
  stdio: "inherit",
});
console.log("[build-web] Terminé -> app/dist");