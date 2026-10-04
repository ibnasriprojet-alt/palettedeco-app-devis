// Generateur d'icones PWA (PNG pur, sans dependance)
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "app", "public", "icons");
mkdirSync(outDir, { recursive: true });

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixels) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 3);
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

  const top = hex("#a35a1e");
  const bottom = hex("#6b3512");
  const dark = hex("#3c1f0c");

  for (let y = 0; y < size; y++) {
    const t = y / size;
    const r = Math.round(top[0] + (bottom[0] - top[0]) * t);
    const g = Math.round(top[1] + (bottom[1] - top[1]) * t);
    const b = Math.round(top[2] + (bottom[2] - top[2]) * t);
    const row = y * size;
    for (let x = 0; x < size; x++) {
      const o = (row + x) * 3;
      px[o] = r;
      px[o + 1] = g;
      px[o + 2] = b;
    }
  }

  // cadre interieur (vignette)
  const margin = size * 0.03;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nearEdge = x < margin || y < margin || x > size - margin || y > size - margin;
      if (nearEdge) {
        const o = (y * size + x) * 3;
        px[o] = dark[0];
        px[o + 1] = dark[1];
        px[o + 2] = dark[2];
      }
    }
  }

  function circle(cx, cy, rad, color, hollow) {
    const c = hex(color);
    for (let y = Math.floor(cy - rad); y <= cy + rad; y++) {
      for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (hollow) {
          if (d >= rad - size * 0.02 && d <= rad) {
            const o = (y * size + x) * 3;
            px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2];
          }
        } else if (d <= rad) {
          const o = (y * size + x) * 3;
          px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2];
        }
      }
    }
  }

  // blobs de palette (les "taches" de peinture)
  const r = size * 0.16;
  const c = size * 0.5;
  const off = size * 0.22;
  circle(c - off * 0.72, c - off * 0.72, r, "#14b8a6", false);
  circle(c + off * 0.72, c - off * 0.55, r * 0.9, "#f59e0b", false);
  circle(c + off * 0.42, c + off * 0.8, r * 0.8, "#8b5cf6", false);
  circle(c - off * 0.9, c + off * 0.62, r * 0.7, "#f43f5e", false);
  // trou du pouce
  circle(c - off * 0.35, c + off * 0.05, r * 0.32, "#fffbeb", true);

  return px;
}

for (const size of [192, 512, 180]) {
  const px = drawIcon(size);
  writeFileSync(join(outDir, `icon-${size}.png`), encodePng(size, px));
}
writeFileSync(join(outDir, "maskable-512.png"), encodePng(512, drawIcon(512)));

const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#6b3512"/>
  <circle cx="22" cy="22" r="10" fill="#14b8a6"/>
  <circle cx="43" cy="18" r="9" fill="#f59e0b"/>
  <circle cx="46" cy="40" r="8" fill="#8b5cf6"/>
  <circle cx="17" cy="42" r="7" fill="#f43f5e"/>
  <circle cx="30" cy="31" r="4" fill="none" stroke="#fffbeb" stroke-width="3"/>
</svg>`;
writeFileSync(join(outDir, "favicon.svg"), faviconSvg);
console.log("Icônes générées dans", outDir);