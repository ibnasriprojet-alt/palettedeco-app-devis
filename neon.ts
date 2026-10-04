import { defineConfig, type FunctionBundlerInput } from "@neon/config/v1";
import { build } from "esbuild";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const ESM_CJS_INTEROP_BANNER =
  "import{createRequire as ___cr}from'module';import{fileURLToPath as ___f}from'url';import{dirname as ___d}from'path';const require=___cr(import.meta.url);const __filename=___f(import.meta.url);const __dirname=___d(__filename);";

const bundler: FunctionBundlerInput = async (fn) => {
  const result = await build({
    entryPoints: [join(here, fn.source)],
    bundle: true,
    platform: "node",
    format: "esm",
    minify: true,
    banner: { js: ESM_CJS_INTEROP_BANNER },
    write: false,
  });
  const files: Record<string, Uint8Array> = {
    "index.mjs": result.outputFiles[0].contents,
    "package.json": new TextEncoder().encode(
      JSON.stringify({
        name: "palettedevis-api",
        private: true,
        type: "module",
        imports: { "#standard-fonts/*": "./fonts/*.cjs" },
      }),
    ),
  };
  const fontsDir = join(here, "node_modules/pdfkit/js/standard-fonts");
  const chunksDir = join(fontsDir, "chunks");
  const inline: Record<string, string> = {};
  const chunkNames = await readdir(chunksDir);
  for (const name of chunkNames) {
    if (!name.endsWith(".cjs")) continue;
    const src = await readFile(join(chunksDir, name), "utf8");
    const m = src.match(/var glyphNames = ('[^']*'|"[^"]*");/);
    if (!m) throw new Error(`Cannot parse glyphNames from ${name}`);
    inline[name] = `{ glyphNames: ${m[1]} }`;
  }
  const names = await readdir(fontsDir);
  for (const name of names) {
    if (!name.endsWith(".cjs")) continue;
    let src = await readFile(join(fontsDir, name), "utf8");
    src = src.replace(/require\(['"]\.\/chunks\/([^'"]+)['"]\)/g, (_all, chunk: string) => {
      const value = inline[chunk];
      if (!value) throw new Error(`Missing inline chunk for ${chunk}`);
      return value;
    });
    files[`fonts/${name}`] = new TextEncoder().encode(src);
  }
  return files;
};

const apiToken = process.env.API_TOKEN;
const brevoApiKey = process.env.BREVO_API_KEY;
const resendApiKey = process.env.RESEND_API_KEY;
const emailFrom = process.env.EMAIL_FROM;
const sessionSecret = process.env.SESSION_SECRET;
const allowedOrigin = process.env.ALLOWED_ORIGIN;

export default defineConfig({
  functions: {
    api: {
      name: "PaletteDevis API",
      source: "src/index.ts",
      bundler,
      env: {
        ...(apiToken ? { API_TOKEN: apiToken } : {}),
        ...(brevoApiKey ? { BREVO_API_KEY: brevoApiKey } : {}),
        ...(resendApiKey ? { RESEND_API_KEY: resendApiKey } : {}),
        ...(emailFrom ? { EMAIL_FROM: emailFrom } : {}),
        ...(sessionSecret ? { SESSION_SECRET: sessionSecret } : {}),
        ...(allowedOrigin ? { ALLOWED_ORIGIN: allowedOrigin } : {}),
      },
    },
  },
});